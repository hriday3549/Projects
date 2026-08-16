import os
import json
import hashlib
import tempfile
import threading
import concurrent.futures
import queue  
import tkinter as tk  # <-- Added standard tkinter for the Canvas

import customtkinter as ctk
from PIL import Image

# Supported image extensions
IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.bmp', '.webp', '.gif')

THUMB_SIZE = (150, 150)
PAGE_SIZE = 60                                  
MAX_WORKERS = min(16, (os.cpu_count() or 4) * 2)  

CACHE_DIR = os.path.join(tempfile.gettempdir(), "gallery_thumb_cache")
os.makedirs(CACHE_DIR, exist_ok=True)

SCAN_INDEX_FILE = os.path.join(CACHE_DIR, "scan_index.json")
SETTINGS_FILE = os.path.join(CACHE_DIR, "settings.json")


def _cache_path_for(path, mtime):
    key = f"{path}|{mtime}".encode("utf-8")
    digest = hashlib.md5(key).hexdigest()
    return os.path.join(CACHE_DIR, f"{digest}.jpg")


class GalleryApp(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("Windows Photo Gallery")
        self.geometry("1100x750")
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        self.all_images = []          
        self.current_list = []        
        self.displayed_count = 0      
        self.thumbnail_cache = {}     
        self.folder_vars = {}         
        self.stop_event = threading.Event()
        
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS)
        self.thumbnail_queue = queue.Queue()  
        self.ui_queue = queue.Queue() 

        self.saved_folder_states = self._load_settings()

        self.protocol("WM_DELETE_WINDOW", self.on_close)

        self.setup_ui()
        self.check_queue()  

        default_scan_path = os.path.expanduser("~")

        cached = self._load_cached_index(default_scan_path)
        if cached:
            self.all_images = cached
            self.status_label.configure(text=f"Loaded {len(cached)} images from cache.\nRefreshing...")
            self.update_folder_checkboxes()
            self.sort_and_display()
        else:
            self.status_label.configure(text="Scanning folders... please wait.")

        self.after(200, lambda: threading.Thread(target=self.scan_directory, args=(default_scan_path,), daemon=True).start())

    def check_queue(self):
        while not self.thumbnail_queue.empty():
            try:
                path, row, col, placeholder, pil_img, folder_path = self.thumbnail_queue.get_nowait()
                self._on_thumbnail_ready(pil_img, path, row, col, placeholder, folder_path)
            except queue.Empty:
                break
                
        while not self.ui_queue.empty():
            try:
                ui_task = self.ui_queue.get_nowait()
                ui_task()  
            except queue.Empty:
                break
        
        if not self.stop_event.is_set():
            self.after(100, self.check_queue)

    def _load_cached_index(self, root_dir):
        try:
            with open(SCAN_INDEX_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if data.get("root") == root_dir:
                return data.get("images", [])
        except Exception:
            pass
        return None

    def _save_cached_index(self, root_dir, images):
        try:
            with open(SCAN_INDEX_FILE, "w", encoding="utf-8") as f:
                json.dump({"root": root_dir, "images": images}, f)
        except Exception:
            pass 

    def _load_settings(self):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _save_settings(self):
        try:
            with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
                json.dump(self.saved_folder_states, f)
        except Exception:
            pass

    def setup_ui(self):
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        self.sidebar = ctk.CTkFrame(self, width=280, corner_radius=0)
        self.sidebar.grid(row=0, column=0, sticky="nsew", padx=10, pady=10)

        lbl_sort = ctk.CTkLabel(self.sidebar, text="Sort Images By:", font=ctk.CTkFont(size=16, weight="bold"))
        lbl_sort.pack(padx=20, pady=(20, 10))

        self.sort_option = ctk.CTkOptionMenu(
            self.sidebar,
            values=["Name", "Date Modified", "Size", "Folder Path"],
            command=self.sort_and_display
        )
        self.sort_option.pack(padx=20, pady=10)

        lbl_search = ctk.CTkLabel(self.sidebar, text="Search filename:")
        lbl_search.pack(padx=20, pady=(20, 5))
        self.search_entry = ctk.CTkEntry(self.sidebar, placeholder_text="e.g. vacation")
        self.search_entry.pack(padx=20, pady=5)
        self.search_entry.bind("<Return>", lambda e: self.sort_and_display())

        lbl_folders = ctk.CTkLabel(self.sidebar, text="Filter by Folder:", font=ctk.CTkFont(size=14, weight="bold"))
        lbl_folders.pack(padx=20, pady=(20, 5))

        # --- NEW: Select/Deselect All Buttons ---
        self.btn_frame = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        self.btn_frame.pack(padx=10, pady=(0, 5), fill="x")
        
        self.btn_select_all = ctk.CTkButton(self.btn_frame, text="Select All", width=100, command=self.select_all_folders)
        self.btn_select_all.pack(side="left", expand=True, padx=2)
        
        self.btn_deselect_all = ctk.CTkButton(self.btn_frame, text="Deselect All", width=100, command=self.deselect_all_folders)
        self.btn_deselect_all.pack(side="right", expand=True, padx=2)

        # --- NEW: Custom Bidirectional Scrollable Container for Folders ---
        self.folder_container = ctk.CTkFrame(self.sidebar, height=220)
        self.folder_container.pack(padx=10, pady=5, fill="both", expand=True)

        # Match Canvas background to CustomTkinter Frame background
        bg_color = self._apply_appearance_mode(ctk.ThemeManager.theme["CTkFrame"]["fg_color"])
        
        self.folder_canvas = tk.Canvas(self.folder_container, bg=bg_color, highlightthickness=0)
        self.folder_scrollbar_y = ctk.CTkScrollbar(self.folder_container, orientation="vertical", command=self.folder_canvas.yview)
        self.folder_scrollbar_x = ctk.CTkScrollbar(self.folder_container, orientation="horizontal", command=self.folder_canvas.xview)

        self.folder_canvas.configure(yscrollcommand=self.folder_scrollbar_y.set, xscrollcommand=self.folder_scrollbar_x.set)

        self.folder_scrollbar_y.pack(side="right", fill="y")
        self.folder_scrollbar_x.pack(side="bottom", fill="x")
        self.folder_canvas.pack(side="left", fill="both", expand=True)

        self.folder_inner_frame = ctk.CTkFrame(self.folder_canvas, fg_color=bg_color)
        self.folder_window = self.folder_canvas.create_window((0, 0), window=self.folder_inner_frame, anchor="nw")

        self.folder_inner_frame.bind("<Configure>", lambda e: self.folder_canvas.configure(scrollregion=self.folder_canvas.bbox("all")))

        # Safely bind mousewheel only when hovering over the folder list
        def _on_mousewheel(event):
            self.folder_canvas.yview_scroll(int(-1*(event.delta/120)), "units")
            
        self.folder_canvas.bind("<Enter>", lambda e: self.folder_canvas.bind_all("<MouseWheel>", _on_mousewheel))
        self.folder_canvas.bind("<Leave>", lambda e: self.folder_canvas.unbind_all("<MouseWheel>"))
        # -----------------------------------------------------------------

        self.status_label = ctk.CTkLabel(self.sidebar, text="Initializing...", wraplength=160, font=ctk.CTkFont(size=12))
        self.status_label.pack(padx=20, side="bottom", pady=20)

        self.right_frame = ctk.CTkFrame(self)
        self.right_frame.grid(row=0, column=1, sticky="nsew", padx=10, pady=10)
        self.right_frame.grid_columnconfigure(0, weight=1)
        self.right_frame.grid_rowconfigure(0, weight=1)

        self.scroll_frame = ctk.CTkScrollableFrame(self.right_frame, label_text="Your Photos")
        self.scroll_frame.grid(row=0, column=0, sticky="nsew", padx=5, pady=5)

        for i in range(4):
            self.scroll_frame.grid_columnconfigure(i, weight=1)

        self.load_more_btn = ctk.CTkButton(self.scroll_frame, text="Load more", command=self.load_more)

    def select_all_folders(self):
        for folder, var in self.folder_vars.items():
            var.set(True)
            self.saved_folder_states[folder] = True
        self._save_settings()
        self.sort_and_display()

    def deselect_all_folders(self):
        for folder, var in self.folder_vars.items():
            var.set(False)
            self.saved_folder_states[folder] = False
        self._save_settings()
        self.sort_and_display()

    def scan_directory(self, root_dir):
        ignored_dirs = {
            'AppData', 'Program Files', 'Program Files (x86)', 'Windows',
            '$Recycle.Bin', 'System Volume Information', 'node_modules', '.git'
        }

        found_images = []
        last_update_count = 0
        for root, dirs, files in os.walk(root_dir):
            if self.stop_event.is_set():
                return 

            dirs[:] = [d for d in dirs if d not in ignored_dirs and not d.startswith('.')]

            for file in files:
                if file.lower().endswith(IMAGE_EXTENSIONS):
                    full_path = os.path.join(root, file)
                    try:
                        stats = os.stat(full_path)
                        found_images.append({
                            'path': full_path,
                            'name': file.lower(),
                            'time': stats.st_mtime,
                            'size': stats.st_size,
                            'folder': root 
                        })
                    except (PermissionError, FileNotFoundError, OSError):
                        continue

            if len(found_images) - last_update_count >= 50:
                last_update_count = len(found_images)
                self.update_status(f"Found {len(found_images)} images...")

        self.all_images = found_images
        self._save_cached_index(root_dir, found_images)
        self.update_status(f"Scan complete!\nTotal: {len(found_images)} images.")
        
        self.ui_queue.put(self.update_folder_checkboxes)
        self.ui_queue.put(self.sort_and_display)

    def update_status(self, text):
        self.ui_queue.put(lambda: self.status_label.configure(text=text))

    def update_folder_checkboxes(self):
        for widget in self.folder_inner_frame.winfo_children():
            widget.destroy()
        self.folder_vars.clear()

        unique_folders = sorted({img.get('folder', '') for img in self.all_images if img.get('folder')})
        user_home = os.path.expanduser("~")

        for folder in unique_folders:
            is_checked = self.saved_folder_states.get(folder, True)
            var = ctk.BooleanVar(value=is_checked)
            self.folder_vars[folder] = var
            
            # The full, untruncated path is shown here
            display_name = folder.replace(user_home, "~")
            
            cb = ctk.CTkCheckBox(
                self.folder_inner_frame,
                text=display_name,
                variable=var,
                font=ctk.CTkFont(size=11), 
                command=lambda f=folder, v=var: self._on_folder_toggle(f, v)
            )
            cb.pack(padx=5, pady=3, anchor="w")

    def _on_folder_toggle(self, folder, var):
        is_checked = var.get()
        self.saved_folder_states[folder] = is_checked

        # --- NEW: Automatic Parent/Child Cascade ---
        if not is_checked:
            # If a folder is unchecked, uncheck all of its subfolders automatically
            folder_prefix = folder + os.sep
            for child_folder, child_var in self.folder_vars.items():
                if child_folder.startswith(folder_prefix) and child_var.get():
                    child_var.set(False)
                    self.saved_folder_states[child_folder] = False

        self._save_settings()
        self.sort_and_display()

    def get_filtered_images(self):
        query = self.search_entry.get().strip().lower()
        allowed_folders = {folder for folder, var in self.folder_vars.items() if var.get()}

        filtered = []
        for img in self.all_images:
            img_folder = img.get('folder')
            if self.folder_vars and img_folder not in allowed_folders:
                continue
            if query and query not in img['name']:
                continue
            filtered.append(img)
            
        return filtered

    def sort_and_display(self, *args):
        criteria = self.sort_option.get()
        images = self.get_filtered_images()

        if criteria == "Name":
            images = sorted(images, key=lambda x: x['name'])
        elif criteria == "Date Modified":
            images = sorted(images, key=lambda x: x['time'], reverse=True)
        elif criteria == "Size":
            images = sorted(images, key=lambda x: x['size'], reverse=True)
        elif criteria == "Folder Path":
            images = sorted(images, key=lambda x: (x.get('folder', ''), x['name']))

        self.current_list = images
        self.displayed_count = 0

        for widget in self.scroll_frame.winfo_children():
            if widget not in (self.scroll_frame._label, self.load_more_btn):
                widget.destroy()

        self.load_more()

    def load_more(self):
        start = self.displayed_count
        end = min(start + PAGE_SIZE, len(self.current_list))

        for index in range(start, end):
            img_data = self.current_list[index]
            row = index // 4
            col = index % 4
            folder_path = img_data['folder']

            cached = self.thumbnail_cache.get(img_data['path'])
            if cached is not None:
                self._place_thumbnail(cached, img_data['path'], row, col, folder_path)
                continue

            placeholder = ctk.CTkButton(self.scroll_frame, text="...", fg_color="transparent")
            placeholder.grid(row=row, column=col, padx=10, pady=10, sticky="nsew")

            def worker_task(p=img_data['path'], m=img_data['time'], r=row, c=col, ph=placeholder, fp=folder_path):
                img = self._build_thumbnail(p, m)
                self.thumbnail_queue.put((p, r, c, ph, img, fp))

            self.executor.submit(worker_task)

        self.displayed_count = end

        self.load_more_btn.grid_forget()
        if self.displayed_count < len(self.current_list):
            next_row = (self.displayed_count // 4) + 1
            self.load_more_btn.grid(row=next_row, column=0, columnspan=4, pady=15)

    def _build_thumbnail(self, path, mtime):
        cache_file = _cache_path_for(path, mtime)
        try:
            if os.path.exists(cache_file):
                with Image.open(cache_file) as pil_img:
                    return pil_img.copy()

            with Image.open(path) as pil_img:
                try:
                    pil_img.draft("RGB", THUMB_SIZE)
                except Exception:
                    pass
                pil_img.thumbnail(THUMB_SIZE)
                out_img = pil_img.convert("RGB")
            
            try:
                out_img.save(cache_file, "JPEG", quality=85)
            except Exception:
                pass 
            return out_img
        except Exception:
            return None

    def _on_thumbnail_ready(self, pil_img, path, row, col, placeholder, folder_path):
        if self.stop_event.is_set():
            return
        
        try:
            placeholder.destroy()
        except Exception:
            pass 

        if pil_img is None:
            return 

        ctk_img = ctk.CTkImage(light_image=pil_img, dark_image=pil_img, size=pil_img.size)
        self.thumbnail_cache[path] = ctk_img
        self._place_thumbnail(ctk_img, path, row, col, folder_path)

    def _place_thumbnail(self, ctk_img, path, row, col, folder_path):
        folder_name = os.path.basename(folder_path)
        display_text = folder_name[:18] + ".." if len(folder_name) > 20 else folder_name

        img_btn = ctk.CTkButton(
            self.scroll_frame,
            image=ctk_img,
            text=display_text,              
            compound="top",                 
            font=ctk.CTkFont(size=11),
            text_color=("gray10", "gray80"),
            fg_color="transparent",
            hover_color="#2b2b2b",
            command=lambda p=path: self.open_large_image(p)
        )
        img_btn.grid(row=row, column=col, padx=10, pady=10, sticky="nsew")

    def open_large_image(self, path):
        top = ctk.CTkToplevel(self)
        top.title(os.path.basename(path))
        top.geometry("600x680")
        top.attributes('-topmost', True)

        loading_lbl = ctk.CTkLabel(top, text="Loading...")
        loading_lbl.pack(expand=True)

        def worker():
            try:
                with Image.open(path) as full_pil:
                    full_pil.thumbnail((550, 550))
                    safe_copy = full_pil.copy()
                
                self.ui_queue.put(lambda: show(safe_copy))
            except Exception as e:
                self.ui_queue.put(lambda: loading_lbl.configure(text=f"Could not open image:\n{e}"))

        def show(pil_img):
            display_img = ctk.CTkImage(light_image=pil_img, dark_image=pil_img, size=pil_img.size)
            loading_lbl.destroy()
            
            lbl = ctk.CTkLabel(top, image=display_img, text="")
            lbl.image = display_img  
            lbl.pack(expand=True, fill="both", padx=20, pady=10)

            controls = ctk.CTkFrame(top, fg_color="transparent")
            controls.pack(side="bottom", fill="x", pady=15, padx=20)

            btn_rotate = ctk.CTkButton(controls, text="Rotate 90°", command=lambda: self.rotate_photo(path, top))
            btn_rotate.pack(side="left", expand=True, padx=10)

            btn_delete = ctk.CTkButton(controls, text="Delete", fg_color="#C62828", hover_color="#B71C1C", command=lambda: self.delete_photo(path, top))
            btn_delete.pack(side="right", expand=True, padx=10)

        threading.Thread(target=worker, daemon=True).start()

    def rotate_photo(self, path, top_window):
        try:
            with Image.open(path) as img:
                rotated = img.transpose(Image.ROTATE_270)
                rotated.save(path, quality=95)
            
            new_mtime = os.stat(path).st_mtime
            for img in self.all_images:
                if img['path'] == path:
                    img['time'] = new_mtime
                    break
                    
            if path in self.thumbnail_cache:
                del self.thumbnail_cache[path]
                
            top_window.destroy()
            self.sort_and_display()
        except Exception as e:
            print(f"Failed to rotate: {e}")

    def delete_photo(self, path, top_window):
        try:
            os.remove(path)
            
            self.all_images = [img for img in self.all_images if img['path'] != path]
            
            if path in self.thumbnail_cache:
                del self.thumbnail_cache[path]
                
            top_window.destroy()
            self.sort_and_display()
        except Exception as e:
            print(f"Failed to delete: {e}")

    def on_close(self):
        self.stop_event.set()
        self.executor.shutdown(wait=False, cancel_futures=True)
        self.destroy()


if __name__ == "__main__":
    app = GalleryApp()
    app.mainloop()
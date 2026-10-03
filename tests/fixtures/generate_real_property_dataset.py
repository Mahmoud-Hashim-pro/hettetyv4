import os
import numpy as np
from PIL import Image, ImageDraw

output_dir = os.path.join("tests", "fixtures", "real_properties", "prop_villa_marassi_01")
os.makedirs(output_dir, exist_ok=True)

rooms = [
    ("01_living_room_wide_center", (220, 215, 205), "LIVING ROOM - WIDE ANGLE CENTER"),
    ("02_living_room_sofa_left", (215, 210, 200), "LIVING ROOM - SOFA 45 DEG LEFT"),
    ("03_living_room_sofa_right", (218, 212, 202), "LIVING ROOM - SOFA 45 DEG RIGHT"),
    ("04_living_room_tv_media_wall", (200, 195, 190), "LIVING ROOM - TV MEDIA WALL"),
    ("05_living_room_window_terrace", (230, 235, 245), "LIVING ROOM - PATIO GLASS SLIDER"),
    ("06_living_room_terrace_threshold", (225, 220, 210), "TERRACE - THRESHOLD OVERLOOK"),
    ("07_dining_table_wide", (210, 205, 195), "DINING - 8-SEAT MARBLE TABLE"),
    ("08_dining_chairs_side_angle", (208, 202, 192), "DINING - CHAIRS & SCONCES"),
    ("09_entrance_foyer_console", (235, 230, 220), "ENTRANCE FOYER - CONSOLE MIRROR"),
    ("10_corridor_gallery_view", (225, 220, 215), "CENTRAL CORRIDOR - RECESSED LIGHTS"),
    ("11_doorway_master_suite", (215, 210, 205), "MASTER SUITE - DOORWAY PERSPECTIVE"),
    ("12_master_bed_center_view", (220, 215, 210), "MASTER BEDROOM - KING BED CENTER"),
    ("13_master_bed_angle_left", (218, 212, 208), "MASTER BEDROOM - LEFT NIGHTSTAND"),
    ("14_master_bed_angle_right", (222, 216, 212), "MASTER BEDROOM - RIGHT NIGHTSTAND"),
    ("15_master_walkin_closet", (190, 185, 180), "MASTER - WALK-IN CLOSET CABINETS"),
    ("16_master_balcony_window", (235, 240, 250), "MASTER - BALCONY SUNLIGHT"),
    ("17_kitchen_island_waterfall", (210, 215, 220), "KITCHEN - GRANITE WATERFALL ISLAND"),
    ("18_kitchen_cabinets_backsplash", (200, 205, 210), "KITCHEN - TILE BACKSPLASH & HOOD"),
    ("19_kitchen_undermount_sink", (205, 210, 215), "KITCHEN - SINK & QUARTZ COUNTER"),
    ("20_kitchen_refrigerator_tower", (195, 198, 202), "KITCHEN - BUILT-IN OVEN TOWER"),
    ("21_guest_bedroom_twin_beds", (225, 220, 218), "GUEST BEDROOM - TWIN BEDS"),
    ("22_guest_study_desk_window", (230, 228, 225), "GUEST BEDROOM - STUDY DESK & SHELVES"),
    ("23_master_bath_double_vanity", (240, 242, 245), "MASTER BATH - DOUBLE FLOATING VANITY"),
    ("24_master_bath_walkin_shower", (235, 238, 240), "MASTER BATH - GLASS RAIN SHOWER"),
    ("25_master_bath_freestanding_tub", (245, 245, 248), "MASTER BATH - FREESTANDING TUB"),
    ("26_powder_room_pedestal_sink", (220, 215, 210), "POWDER ROOM - MOROCCAN ACCENT TILE"),
    ("27_terrace_pergola_lounge", (230, 225, 215), "OUTDOOR TERRACE - PERGOLA LOUNGE"),
    ("28_terrace_pool_vista", (215, 230, 245), "OUTDOOR TERRACE - POOL & GARDEN VISTA"),
]

for idx, (name, base_rgb, label) in enumerate(rooms):
    w, h = 1280, 720
    arr = np.zeros((h, w, 3), dtype=np.uint8)
    
    # Ceiling, wall, floor y-split
    ceiling_end = int(h * 0.25)
    floor_start = int(h * 0.65)
    
    arr[:ceiling_end, :] = [int(c * 0.95) for c in base_rgb]
    arr[ceiling_end:floor_start, :] = [int(c * 1.0) for c in base_rgb]
    arr[floor_start:, :] = [int(c * 0.75) for c in base_rgb]
    
    img = Image.fromarray(arr)
    draw = ImageDraw.Draw(img)
    
    # Perspective tiles / floorboards
    for x in range(0, w, 50):
        draw.line([(w // 2, floor_start), (x * 2 - w // 2, h)], fill=(120, 100, 80), width=2)
    for y in range(floor_start, h, 30):
        draw.line([(0, y), (w, y)], fill=(130, 110, 90), width=2)
        
    # Architectural doorway and window mullions
    draw.rectangle([int(w * 0.12), int(h * 0.25), int(w * 0.40), int(h * 0.65)], outline=(70, 70, 70), width=3)
    draw.rectangle([int(w * 0.58), int(h * 0.28), int(w * 0.88), int(h * 0.65)], outline=(80, 75, 70), width=4)
    # Window panes
    draw.line([(int(w * 0.26), int(h * 0.25)), (int(w * 0.26), int(h * 0.65))], fill=(90, 110, 130), width=2)
    draw.line([(int(w * 0.12), int(h * 0.45)), (int(w * 0.40), int(h * 0.45))], fill=(90, 110, 130), width=2)
    
    # Furniture silhouette (sofa / island / bed)
    draw.rectangle([int(w * 0.22), int(h * 0.50), int(w * 0.78), int(h * 0.72)], fill=(160, 140, 120), outline=(50, 45, 40), width=3)
    
    # High-frequency edge texture for high Laplacian sharpness
    noise = np.random.randint(-18, 18, (h, w, 3), dtype=np.int16)
    textured = np.clip(np.array(img, dtype=np.int16) + noise, 0, 255).astype(np.uint8)
    img_textured = Image.fromarray(textured)
    draw2 = ImageDraw.Draw(img_textured)
    
    # Header label
    draw2.rectangle([40, 30, 600, 80], fill=(20, 20, 20))
    draw2.text((50, 48), f"HETTETY VILLA MARASSI - FRAME {idx+1:02d}: {label}", fill=(255, 255, 255))
    
    file_path = os.path.join(output_dir, f"frame_{idx+1:02d}_{name}.jpg")
    img_textured.save(file_path, "JPEG", quality=95)

print(f"Successfully generated {len(rooms)} architectural keyframe images in {output_dir}")

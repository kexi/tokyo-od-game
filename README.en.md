# 法令厳守 TOKYO OPEN DRIVE

[日本語](README.md) | **English** | [中文](README.zh.md)

A 3D driving and exploration game built with three.js, in which you drive around Tokyo's 23 wards in a world made from Tokyo Metropolitan Government open data × PLATEAU 3D city models. (In English the game is "Law-Abiding TOKYO OPEN DRIVE".)

**Play:** https://kexi.github.io/tokyo-od-game/

- Buildings come from MLIT's (Ministry of Land, Infrastructure, Transport and Tourism) PLATEAU 3D city models (LOD1 buildings, every building in the 23 wards), streamed straight into the browser from around where you are driving.
- Sidewalks are drawn as paving with curbs from the sidewalk parts of PLATEAU's LOD2 road models (LOD2 covers most of Chiyoda, Chuo, Taito and Minato, and parts of the other wards). Pedestrians walk on the sidewalks, wait for the signal at crosswalks and cross the road. On narrow roads without a sidewalk they walk along the right edge of the road (道路交通法 (Road Traffic Act) Art. 10).
- The terrain is generated from GSI's (Geospatial Information Authority of Japan) elevation tiles (DEM5A/DEM10B), and the Rapier physics engine handles collisions between cars, buildings and the ground.
- The pillars of light are real places from the open data of the Tokyo Metropolitan Government and the wards (cultural properties, famous sights, night-view spots, metropolitan facilities, drinking fountains, emergency water stations, evacuation sites, Toei stations and more).
- Toei buses run based on their real-time positions (Public Transportation Open Data Center), and the weather reflects the observations of JMA's (Japan Meteorological Agency) AMeDAS station in Tokyo.
- You can choose the time of day from "Real time / Morning / Day / Evening / Night" (the presets are set from that day's actual sun altitude).
- Roads are drawn from the center lines and widths in GSI's vector tiles (experimental release). Lane lines and road markings follow the 道路標識、区画線及び道路標示に関する命令 (Order on Road Signs, Lane Lines and Road Markings) and JARTIC's (Japan Road Traffic Information Center) traffic regulation information (Metropolitan Police Department): yellow center lines where overtaking across them is prohibited, lanes and yellow lane lines where lane changes are prohibited, yellow speed-limit numbers, crosswalks with their ◇ advance markings, and stop lines. Road signs (maximum speed, one way, no entry for vehicles, no parking, no stopping or parking, no U-turn, slow down, stop, designated direction only, crosswalk) stand at JARTIC's regulated sections and points. Traffic signal positions are imported from OpenStreetMap, and the signal heads (for vehicles and for pedestrians) and signal poles are modeled with Blender CLI (`scripts/blender/signals.py`). A pedestrian signal is green only while the vehicle signal in the crossing direction is green, and flashes for its last 5 seconds. Sign posts and signal poles have collisions. Taxis, ordinary cars and parked cars drive on the left and stop at red lights and at "止まれ" (stop) signs. Toei buses follow the left lane of the road.
- Violations are judged according to the Road Traffic Act. They cover running a red light, failing to stop at a stop sign, wrong way down a one-way street and prohibited turns (against the direction sign) (通行禁止違反, no-passage violations), illegal U-turns (指定横断等禁止違反), not slowing down where required, prohibited lane changes, speeding (against the posted limit, or on roads without one, the statutory limit as amended on 2026-09-01), lane-use violations (通行区分違反), using a phone while driving, leaving a car parked illegally, careless driving, and the additional points for injury accidents. 6 points suspend your license, and 15 or more revoke it. Every violation stamps a seal on the screen. Regulations apply exactly according to JARTIC's time-of-day designations.
- If you leave your car in a no-parking or no-stopping zone and walk away, a parking enforcement officer comes, takes photos and puts on an unattended-vehicle sticker (放置車両確認標章). When you get back, you choose whether to report to the police station (fine and points) or not to report (the car's owner pays an unattended-parking charge; no points). Sections without regulations are not enforced.
- The ambulance is a high-spec ambulance modeled with Blender CLI; the stripe on its sides, its rear, and the mirror-written "救急" (emergency) decal on the hood were drawn by agy (no red cross or similar emblems are used).
- If you hit someone, you call 119 or 110 on your phone. Gemma plays the dispatcher, and once you tell them where you are and what happened, an ambulance and a patrol car arrive. If you flee, patrol cars chase you and you are arrested for hit and run (failure to aid the injured, 35 points).
- The idling stop (switching the engine off while stopped or parked) of the 東京都環境確保条例 (Tokyo Metropolitan Environmental Security Ordinance) is supported.
- You can also play on Android (Chrome) with touch controls in landscape and fullscreen. On iOS the conversation AI is not available, and people answer with set replies.
- The cars are modeled procedurally with Blender CLI (`scripts/blender/car.py` → `public/models/car.glb`). There is a detailed model for your car (about 50,000 triangles, with an interior, door seams, mirrors and brake calipers), a low-poly version for AI cars (about 3,000 triangles), and a taxi version of each. The textures are generated procedurally too (`assets/car/textures/`).
- In destination missions the navi guides you along the roads (voice guidance such as "In 300 meters, turn right.", an arrow for the next turn, and a blue line on the minimap). The route obeys one-way streets (including those limited to certain hours) and designated-direction-only rules, and is recalculated if you leave it.
- You can call a self-driving taxi (level 4, no driver) with an app on your phone. It comes to pick you up from a nearby road and drives you by the law to your destination (the mission's destination, your own car, or a nearby station or spot). Fares are calculated with the fares for Tokyo's special wards and the Musashino–Mitaka area as revised on April 20, 2026. While you ride, your own car left on the street may be enforced as illegally parked.
- The O key (or the "Autopilot" button) puts your car on autopilot. During a mission it drives to the destination; otherwise it cruises around the area, obeying signals, stop signs, one-way streets, road closures, designated-direction-only rules and speed limits. Steering, accelerating or braking cancels it.
- The speedometer dial shows the maximum speed of the road you are on (posted, zone or statutory) and marks the range above it in red.
- Besides Tokyo Station, you can start from any Toei station or from your browser's location (inside the 23 wards only).
- Building facades are chosen by height from 8 types (glass offices, tiled, apartment blocks, multi-tenant buildings, warehouses, brick and more), and their windows light up at night. The pedestrians and road signs are also modeled in Blender.
- You can get out of the car and walk. Talk to a pedestrian and they tell you the direction and distance of real places nearby. The conversation AI (Gemma 4, running on your device) and voices (sanoTTS-jp) can be turned on if you like.

## Controls

| Key       | Action                                                                        |
| --------- | ----------------------------------------------------------------------------- |
| W / ↑     | Accelerate                                                                    |
| S / ↓     | Brake (reverse when stopped)                                                  |
| A D / ← → | Steer                                                                         |
| Space     | Parking brake                                                                 |
| R         | Right the car / reset                                                         |
| N         | Destination mission                                                           |
| T         | Switch the time of day                                                        |
| Y         | Switch the weather (Live / Clear / Rain)                                      |
| M         | Switch the ground (GSI latest aerial photos / PLATEAU orthophotos)            |
| C         | Switch camera                                                                 |
| V         | Sound on / off                                                                |
| I         | Data credits                                                                  |
| F         | Get out / in (on foot: WASD, Shift to run, Space to jump, ← → to look around) |
| E         | Talk to a pedestrian nearby (from the car, only when stopped)                 |

Gamepads and touch controls are supported too.

## Development

How to set up the development environment and the workflow are in [CONTRIBUTING.en.md](CONTRIBUTING.en.md). `nix develop` (direnv) provides Node.js 24, pnpm, just, lefthook, uv and more.

```sh
just install-deps          # Install dependencies (packages published less than 1 day ago are not installed)
just serve-dev             # Development server
just check-all             # Check types, lint, formatting, tests, the justfile and Actions
just fetch-data            # Fetch the open data and regenerate public/data (with a license gate)
just fetch-regs            # Regenerate public/data/regs and signals from JARTIC traffic regulations and OSM signals
just make-car-textures     # Regenerate the car textures (uv)
just make-car-model        # Regenerate the car models with Blender CLI (nix develop .#blender)
just make-sign-model       # Regenerate the road sign plates and posts
just make-human-model      # Regenerate the pedestrians
just make-signal-model     # Regenerate the traffic signals (signal heads and poles)
just make-ambulance-model  # Regenerate the ambulance
just make-textures         # Regenerate the sign, pedestrian, facade, signal and ambulance textures (uv)
just open-assets           # Open the asset manager (preview and review models and textures)
just build-app             # Production build into dist/
```

Pushing to `main` makes GitHub Actions deploy to GitHub Pages.

### Asset management and review

Assets are managed in the ledger `assets/manifest.yml`, one entry each, with a name, purpose, generator script and just recipe, source and license. If `assets/` or `public/` (except `public/data`) contains a file that is not in the ledger, `just check-assets` (also part of `just run-tests`) fails, so when you add an asset, add it to the ledger too.

The asset manager (`assets.html`), opened with `just open-assets`, lists every asset in the ledger by kind. Models can be rotated, with toggles for each part, triangle counts and a wireframe view. Textures can be viewed with their transparency over a checkerboard.

Mark each asset OK or 要修正 (needs fixing), write instructions, place pins (click on a texture, Shift+click on a part of a model), and press 「レビューを Claude に送る」 ("send the review to Claude"); the development server writes it out to `.review/pending/`. A Claude Code hook (`.claude/hooks/asset-review-watch.sh`, `asyncRewake`) wakes the session, which fixes the generator scripts and rebuilds the assets following the steps of the `asset-review` skill (`.agents/skills/asset-review/`). The results are shown on the screen.

### Structure

| Path                                         | Role                                                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/geo/`                                   | Conversions between WGS84, ECEF and ENU, the floating origin (LocalFrame), tile coordinates, the sun position                                                |
| `src/world/`                                 | Terrain (DEM → mesh + trimesh collider), PLATEAU buildings (3d-tiles-renderer + colliders + window shader), sky and weather, Toei buses                      |
| `src/physics/`                               | Rapier raycast vehicle                                                                                                                                       |
| `src/game/`                                  | Car models, camera, input, POIs, missions, minimap, sound, credits                                                                                           |
| `scripts/fetch-data.ts`                      | Build-time data generation. Looks up each license through the CKAN API of the Tokyo catalog and stops if it is anything other than CC BY 4.0                 |
| `scripts/blender/car.py`                     | Builds the car body with Blender CLI (bpy) by lofting + subdivision + booleans, fits the lights and number plates to the body by raycasting, and exports glb |
| `scripts/blender/signs.py`, `human.py`       | Road sign plates (circle, inverted triangle, square, rectangle), posts and brackets, and pedestrians (each part exported with its joint as the origin)       |
| `scripts/blender/signals.py`, `ambulance.py` | Traffic signals (vehicle and pedestrian signal heads, signal poles) and the high-spec ambulance                                                              |
| `scripts/textures/*.py`                      | Procedural textures for cars, signs, pedestrians and building facades (Pillow, fixed seeds; made by delegating to agy)                                       |
| `scripts/regulations.ts`                     | Splits JARTIC's traffic regulation information (Shift_JIS, a CSV of about 400 MB) and OSM's traffic signals into z14 tiles and writes them to `public/data/` |

The 23 wards are about 30 km from end to end, and the curvature of the earth makes the far ends sink by about 18 m. So the game uses local coordinates with the origin near the car, and moves the origin via ECEF every time the car gets 1.5 km away from it.

## Data sources

The in-game "Credits" screen (I key) gives the sources of all the data in the format each provider specifies. In summary:

- **Tokyo Metropolitan Government open data** (CC BY 4.0): 文化財一覧 (list of cultural properties; 東京都教育庁, Tokyo Metropolitan Board of Education), 公共施設一覧 (list of public facilities; 東京都デジタルサービス局, Bureau of Digital Services), 都立スポーツ施設一覧 (list of metropolitan sports facilities; 東京都スポーツ推進本部, Sports Promotion Headquarters), Tokyowater Drinking Station 一覧 (list) and 給水拠点一覧データ (list of emergency water stations; 東京都水道局, Bureau of Waterworks), 東京都防災マップ 避難所・避難場所一覧データ (Tokyo disaster prevention map: list of shelters and evacuation sites; 東京都総務局, Bureau of General Affairs), 観光情報（しながわ百景） (tourist information: Shinagawa's 100 views; 品川区, Shinagawa City), 映える夜景スポット (photogenic night-view spots; 江東区, Koto City), 名所・史跡 (famous sights and historic sites; 台東区, Taito City).
  - In every case the latitude, longitude and names are extracted and the format is converted (modified).
  - 東京都提供の「避難所、避難場所データ オープンデータ」を利用しています。(This game uses the "shelter and evacuation site data, open data" provided by the Tokyo Metropolitan Government.)
  - 台東区のデータを利用しています。(This game uses data from Taito City.)
- **3D city models**: 出典：国土交通省 PLATEAUウェブサイト「3D都市モデル（Project PLATEAU）東京都」を加工して作成 (Source: MLIT, PLATEAU website, "3D City Models (Project PLATEAU) Tokyo", processed) (PLATEAU site policy / 公共データ利用規約 第1.0版 (Public Data License 1.0)).
- **GSI**: GSI Tiles (latest nationwide photos (seamless), elevation tiles). The terrain is made by processing GSI Tiles (elevation tiles (Fundamental Geospatial Data digital elevation model)). The tiles are only loaded live; they are not bundled or redistributed.
- **Public transport**: 東京都交通局・公共交通オープンデータ協議会「東京都交通局 バスロケーション情報」「東京都交通局 バス停情報」「東京都交通局 駅情報」 (Bureau of Transportation, Tokyo Metropolitan Government / Association for Open Data of Public Transportation, "Toei bus location information", "Toei bus stop information", "Toei station information"), used with modifications (CC BY 4.0). The data is provided by the Public Transportation Open Data Center, and its accuracy and completeness are not guaranteed. Please do not contact the public transport operators; send questions to [Issues](https://github.com/kexi/tokyo-od-game/issues) instead.
- **Weather**: 出典：気象庁ホームページ（アメダス東京）を加工して作成 (Source: JMA website (AMeDAS Tokyo), processed). The weather in this game is not a JMA forecast or warning.
- **Roads**: 出典：国土地理院ベクトルタイル提供実験 (Source: GSI vector tile experiment) (road center lines and widths; loaded live and processed for drawing and for judging).
- **Traffic regulations**: 出典：「交通規制情報」（公益財団法人日本道路交通情報センター）（https://www.jartic.or.jp/service/opendata/）（2026年10月4日に利用）を加工して作成 (Source: "Traffic Regulation Information" (Japan Road Traffic Information Center) (https://www.jartic.or.jp/service/opendata/) (used on October 4, 2026), processed). One-way streets, maximum speeds, crosswalks, stop lines and stop signs are extracted from the Tokyo data as of August 2026 and matched to the road center lines. When you really drive, follow the signs and road markings on site.
- **Traffic signal positions**: © OpenStreetMap contributors. The extracted data (`public/data/signals/`) is offered under the Open Database License 1.0 (`LICENSE.txt` in the same folder).
- **Town and ward boundaries and population**: 出典：政府統計の総合窓口（e-Stat）「国勢調査 令和2年 小地域（町丁・字等別）境界データ 東京都」を加工して作成 (Source: Portal Site of Official Statistics of Japan (e-Stat), "2020 Population Census, small area (town and block) boundary data, Tokyo", processed) (based on 政府標準利用規約 第2.0版, the Government Standard Terms of Use 2.0). Used to show where you are, to check the spots' coordinates, and for how many pedestrians there are.
- **Geoid height**: EGM2008 (NGA, public domain; via PROJ-data).
- **Speech synthesis**: [sanoTTS-jp](https://github.com/ayutaz/sanoTTS-jp) (code under MIT, model under LicenseRef-sanoTTS-jp-Model-1.0). The attribution notice (A) and the full license text are in `public/tts/` and in the in-game Credits screen.
- **Conversation AI (optional)**: Google Gemma 4 E2B (Apache License 2.0). Only devices where it is turned on download it, straight from Hugging Face, and run it on the device with LiteRT-LM.

### Decisions made after checking the terms of use

- No values derived from GSI's geoid model are distributed, because that might require approval under the 測量法 (Survey Act); the public-domain EGM2008 is used instead.
- Draping GSI's "standard map" (地理院 標準地図) over the 3D terrain is a borderline use that might need an application for approval, so it is not used. Only the photos or the PLATEAU orthophotos are used.
- The GSI Tiles credit is always shown at the bottom of the screen while they are displayed.
- The ward and town where you are is determined from e-Stat's boundary polygons; GSI's reverse geocoder is not called. JMA's JSON is fetched at most once every 10 minutes.
- Coordinate errors in the source data are removed at build time by checking against e-Stat's boundaries (points more than 1 km away from the ward they are listed in).

### Terms of use for the synthesized voices

Based on the conditions of the sanoTTS-jp model (derived from the Tsukuyomi-chan corpus), you must not use the voices this game synthesizes for the following purposes.

- Criticizing or attacking people. (The definition of "criticizing or attacking" follows the Tsukuyomi-chan character license.)
- Calling for support of, or opposition to, a particular political position, religion or ideology.
- Publishing strongly provocative content without zoning.
- Publishing in a way that permits others to reuse the voices (as material).

This game has no way to save or export the voices.

### Network access and privacy

While you play, your browser talks directly to GSI, the PLATEAU distribution service, JMA and the Public Transportation Open Data Center, so your IP address and the like are sent to each service. Your discovery progress is saved only in this browser's localStorage.

## License

- **Source code**: MIT License ([LICENSE](LICENSE))
- **Data**: follows the license of each provider above.
- **Bundled software**: see `THIRD_PARTY_LICENSES.txt` in the build output.

Drop your BMP files into this folder using these exact filenames:
(BMP, PNG, JPG and GIF are all supported — just keep the name consistent)

BAMBOO (竹)
  bamboo_1.bmp   bamboo_2.bmp   bamboo_3.bmp
  bamboo_4.bmp   bamboo_5.bmp   bamboo_6.bmp
  bamboo_7.bmp   bamboo_8.bmp   bamboo_9.bmp

DOTS (餅)
  circle_1.bmp   circle_2.bmp   circle_3.bmp
  circle_4.bmp   circle_5.bmp   circle_6.bmp
  circle_7.bmp   circle_8.bmp   circle_9.bmp

CHARACTERS (萬)
  char_1.bmp     char_2.bmp     char_3.bmp
  char_4.bmp     char_5.bmp     char_6.bmp
  char_7.bmp     char_8.bmp     char_9.bmp

WINDS (風)
  wind_East.bmp  wind_South.bmp  wind_West.bmp  wind_North.bmp

DRAGONS (箭)
  dragon_red.bmp   dragon_green.bmp   dragon_white.bmp

FLOWERS (花)  — numbered 0 to 3 = Plum, Orchid, Chrysanthemum, Bamboo
  flower_0.bmp   flower_1.bmp   flower_2.bmp   flower_3.bmp

SEASONS (季)  — numbered 0 to 3 = Spring, Summer, Autumn, Winter
  season_0.bmp   season_1.bmp   season_2.bmp   season_3.bmp

TOTAL: 34 files

Notes:
- Files missing from this folder will automatically fall back to the
  built-in SVG/text rendering — no errors, no blank tiles.
- You can swap in files one suit at a time.
- Recommended tile size: 80×110 px (portrait), transparent background.
- Other formats work too: just change the extension in tileImagePath()
  inside js/ui.js if you prefer PNG or JPG throughout.

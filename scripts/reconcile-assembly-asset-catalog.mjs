#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const POINTER_URL = "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/current.json";
const CHECKED_DATE = "2026-08-28";

const ADDITIONS = [
  readyPart("B076PVHFBW", "sensor", "gesture_proximity_color", "Adafruit APDS9960 gesture, proximity, and color sensor #3595", "Adafruit APDS9960 Proximity, Light, RGB, and Gesture Sensor - STEMMA QT / Qwiic", "Adafruit", "https://www.amazon.com/dp/B076PVHFBW", "3.3V I2C through the factory-installed STEMMA QT socket.", "factory_qwiic", "https://www.adafruit.com/product/3595"),
  readyPart("B08XKJRT9T", "sensor", "uv_light", "Adafruit LTR390 UV light sensor #4831", "Adafruit LTR390 UV Light Sensor - STEMMA QT/Qwiic", "Adafruit", "https://www.amazon.com/dp/B08XKJRT9T", "3.3V I2C through the factory-installed STEMMA QT socket.", "factory_qwiic", "https://www.adafruit.com/product/4831"),
  readyPart("B0DYVCTTCD", "sensor", "co2", "Adafruit SCD-41 true CO2 sensor breakout #5190", "Adafruit 5190 SCD-41 true CO2 sensor breakout - STEMMA QT / Qwiic", "Adafruit", "https://www.amazon.com/dp/B0DYVCTTCD", "3.3V I2C through the factory-installed STEMMA QT socket.", "factory_qwiic", "https://www.adafruit.com/product/5190"),
  readyPart("B07L5YN11R", "sensor", "voc_air_quality", "Adafruit SGP30 TVOC and eCO2 gas sensor #3709", "Adafruit SGP30 Air Quality Sensor Breakout", "Adafruit", "https://www.amazon.com/dp/B07L5YN11R", "3.3V I2C through the factory-installed STEMMA QT socket on the current exact board revision.", "factory_qwiic", "https://www.adafruit.com/product/3709"),
  readyPart("B0DXD7MT5S", "sensor", "temperature_humidity", "Adafruit SHT45 precision temperature and humidity sensor #5665", "Adafruit SHT45 precision temperature and humidity sensor - STEMMA QT / Qwiic", "Adafruit", "https://www.amazon.com/dp/B0DXD7MT5S", "3.3V I2C through the factory-installed STEMMA QT socket.", "factory_qwiic", "https://www.adafruit.com/product/5665"),
  readyPart("B0GSR68YH9", "sensor", "temperature_humidity", "JTAREA DHT22 AM2302 sensor module with factory cable, 2-pack", "DHT22 Digital Temperature and Humidity Sensor AM2302 Sensors Module with Cable, Pack of 2", "JTAREA", "https://www.amazon.com/dp/B0GSR68YH9", "Factory cable and housed connectors; verify conductor order before power.", "factory_cable", "https://www.amazon.com/dp/B0GSR68YH9", { packQty: 2 }),
  readyPart("B0DYDN9RG4", "sensor", "capacitive_soil_moisture", "DIYables TLC555I capacitive soil moisture sensor with factory connector, 2-pack", "Capacitive Soil Moisture Sensor, TLC555I Chip, for Arduino, ESP32, ESP8266, Raspberry Pi, 2 Pieces", "DIYables", "https://www.amazon.com/dp/B0DYDN9RG4", "3.3V-compatible analog sensor with factory-soldered shrouded connector and supplied three-wire cable.", "factory_cable", "https://diyables.io/products/capacitive-soil-moisture-sensor-module", { packQty: 2 }),
  readyPart("B08D5ZD528", "dev_board", "esp32_wroom_32", "AITRIP ESP-WROOM-32 development board, 3-pack", "ESP-WROOM-32 ESP32 ESP-32S Development Board, 3PCS", "AITRIP", "https://www.amazon.com/dp/B08D5ZD528", "3.3V GPIO; factory-installed dual male headers visible on the exact sale assembly.", "factory_male_header", "https://www.amazon.com/dp/B08D5ZD528", { packQty: 3 }),
  readyPart("B0GR8WYC8C", "dev_board", "esp32_c3_mini", "DORHEA ESP32-C3 Mini development board", "ESP32-C3 Mini Development Board ESP32C3 MCU Board Type-C", "DORHEA", "https://www.amazon.com/dp/B0GR8WYC8C", "3.3V GPIO; exact sale assembly has factory-installed dual male headers.", "factory_male_header", "https://www.amazon.com/dp/B0GR8WYC8C"),
  readyPart("B0H6Z84SSN", "dev_board", "waveshare_esp32_c5_lcd_1_47_m", "Waveshare ESP32-C5-LCD-1.47-M, SKU 34960", "Waveshare ESP32-C5 1.47inch LCD development board with pre-soldered headers", "Waveshare", "https://www.amazon.com/dp/B0H6Z84SSN", "3.3V GPIO; exact -M / SKU 34960 factory-header variant.", "factory_male_header", "https://docs.waveshare.com/ESP32-C5-LCD-1.47"),
  readyPart("B09ZJTVPNW", "dev_board", "esp32_wrover_camera", "AITRIP ESP32-WROVER camera development board", "AITRIP ESP32-WROVER Board with Camera WiFi and Bluetooth Development Board", "AITRIP", "https://www.amazon.com/dp/B09ZJTVPNW", "3.3V GPIO; exact sale assembly has factory-installed dual male headers and camera connector.", "factory_male_header", "https://www.amazon.com/dp/B09ZJTVPNW"),
  readyPart("B0D8T53CQ5", "dev_board", "esp32_wroom_32_usbc", "ELEGOO ESP32-WROOM-32 USB-C development board, 3-pack", "ELEGOO 3PCS ESP-32 Dev Boards, ESP-WROOM-32, USB-C, GPIO Headers", "ELEGOO", "https://www.amazon.com/dp/B0D8T53CQ5", "3.3V GPIO; exact sale assembly has factory-installed dual male GPIO headers.", "factory_male_header", "https://www.amazon.com/dp/B0D8T53CQ5", { packQty: 3 }),
  readyPart("B09NNKJM2H", "sensor", "ultrasonic_distance_hcsr04p", "Rakstore HC-SR04P wide-voltage ultrasonic distance sensor", "Rakstore HC-SR04P Ultrasonic Distance Sensor Module", "Rakstore", "https://www.amazon.com/dp/B09NNKJM2H", "3V-5.5V module with factory-installed four-pin male header; confirm the exact Echo voltage behavior before direct ESP32 use.", "factory_male_header", "https://www.amazon.com/dp/B09NNKJM2H"),
  readyPart("B0DHTMYTCY", "dev_board", "waveshare_esp32_c6_lcd_1_47_m", "Waveshare ESP32-C6-LCD-1.47-M", "Waveshare ESP32-C6 1.47inch LCD Development Board, -M pin-header variant", "Waveshare", "https://www.amazon.com/dp/B0DHTMYTCY", "3.3V GPIO; exact -M factory-header variant.", "factory_male_header", "https://docs.waveshare.com/ESP32-C6-LCD-1.47"),
  readyPart("B0DJX8J1JK", "dev_board", "waveshare_esp32_s3_amoled_1_91_m", "Waveshare ESP32-S3-AMOLED-1.91-M, SKU 28873", "Waveshare ESP32-S3 1.91inch AMOLED development board, pre-soldered -M option", "Waveshare", "https://www.amazon.com/dp/B0DJX8J1JK", "3.3V GPIO; exact -M / SKU 28873 factory-header variant.", "factory_male_header", "https://docs.waveshare.com/ESP32-S3-AMOLED-1.91"),
  readyPart("B09WLRBKWT", "connector", "stemma_qt_to_female_sockets", "Adafruit STEMMA QT / Qwiic cable to premium female sockets #4397", "STEMMA QT/Qwiic JST SH 4-pin Cable with Premium Female Sockets - 150mm Long Ada 4397", "Adafruit", "https://www.amazon.com/dp/B09WLRBKWT", "Factory-crimped JST-SH plug to four housed female sockets; no soldering or crimping.", "factory_crimped_cable", "https://www.adafruit.com/product/4397"),

  // User-approved assembly profiles. These rows deliberately keep the sold
  // connection method explicit instead of pretending every board ships with
  // factory-soldered 0.1-inch pins. The planner may select all of them, while
  // the assembly contract must honor the named socket, cable, adapter, or
  // installed-header profile.
  readyPart("MFG-ADAFRUIT-4698", "sensor", "spectral", "Adafruit AS7341 10-channel spectral sensor #4698", "Adafruit AS7341 10-Channel Light / Color Sensor Breakout - STEMMA QT / Qwiic", "Adafruit", "https://www.adafruit.com/product/4698", "3.3V I2C through the factory-installed STEMMA QT socket.", "factory_qwiic", "https://www.adafruit.com/product/4698", { sourceMarketplace: "Manufacturer direct" }),
  readyPart("B017PEIGIG", "sensor", "orientation_imu", "Adafruit BNO055 absolute orientation sensor #2472", "Adafruit BNO055 Absolute Orientation Sensor Breakout", "Adafruit", "https://www.amazon.com/dp/B017PEIGIG", "3.3V I2C; assembly profile includes the exact 1x6 and 1x4 installed male headers.", "modeled_installed_male_header", "https://github.com/adafruit/Adafruit-BNO055-Breakout-PCB"),
  readyPart("MFG-ADAFRUIT-64", "accessory", "half_size_breadboard", "Adafruit half-size breadboard #64", "Adafruit half-size 400 tie-point solderless breadboard #64", "Adafruit", "https://www.adafruit.com/product/64", "Standard 2.54 mm solderless tie points; no header installation is required.", "solderless_breadboard", "https://www.adafruit.com/product/64", { sourceMarketplace: "Manufacturer direct" }),
  readyPart("B07S8QYDF8", "sensor", "current_power", "Adafruit INA260 current, voltage, and power sensor #4226", "Adafruit INA260 Current Voltage and Power Sensor Breakout #4226", "Adafruit", "https://www.amazon.com/dp/B07S8QYDF8", "3.3V I2C through the factory-installed STEMMA QT socket; measured circuit uses the installed terminal block.", "factory_qwiic", "https://www.adafruit.com/product/4226"),
  readyPart("B07SZ8YVTW", "sensor", "thermocouple", "Adafruit MCP9600 thermocouple amplifier #4101", "Adafruit MCP9600 I2C Thermocouple Amplifier #4101", "Adafruit", "https://www.amazon.com/dp/B07SZ8YVTW", "3.3V I2C through the factory-installed STEMMA QT socket; thermocouple uses the installed terminal block.", "factory_qwiic", "https://www.adafruit.com/product/4101"),
  readyPart("B00OKCQX96", "sensor", "temperature", "Adafruit MCP9808 precision temperature sensor #1782", "Adafruit MCP9808 High Accuracy I2C Temperature Sensor Breakout #1782", "Adafruit", "https://www.amazon.com/dp/B00OKCQX96", "3.3V I2C through the current board revision's factory-installed STEMMA QT socket.", "factory_qwiic", "https://www.adafruit.com/product/1782"),
  readyPart("MFG-ADAFRUIT-4632", "sensor", "particulate_matter", "Adafruit PMSA003I particulate matter breakout #4632", "Adafruit PMSA003I Air Quality Breakout #4632", "Adafruit", "https://www.adafruit.com/product/4632", "Factory JST socket and supplied/compatible keyed cable path; verify red-wire polarity before power.", "factory_jst", "https://www.adafruit.com/product/4632", { sourceMarketplace: "Manufacturer direct" }),
  readyPart("B00KKUECAO", "sensor", "nfc_rfid", "Adafruit PN532 NFC/RFID controller breakout #364", "Adafruit PN532 NFC/RFID Controller Breakout #364", "Adafruit", "https://www.amazon.com/dp/B00KKUECAO", "3.3V logic; assembly profile includes the exact 1x8 interface header and two 1x3 mode-select headers.", "modeled_installed_male_header", "https://github.com/adafruit/Adafruit-PN532-RFID-NFC-Breakout"),
  readyPart("MFG-ADAFRUIT-6426", "sensor", "infrared_presence", "Adafruit STHS34PF80 infrared presence sensor #6426", "Adafruit STHS34PF80 IR Presence / Motion Sensor #6426", "Adafruit", "https://www.adafruit.com/product/6426", "3.3V I2C through the factory-installed STEMMA QT socket.", "factory_qwiic", "https://www.adafruit.com/product/6426", { sourceMarketplace: "Manufacturer direct" }),
  readyPart("B00XW2OFWW", "sensor", "light", "Adafruit TSL2591 high dynamic range light sensor #1980", "Adafruit TSL2591 High Dynamic Range Digital Light Sensor #1980", "Adafruit", "https://www.amazon.com/dp/B00XW2OFWW", "3.3V I2C through the current board revision's factory-installed STEMMA QT socket.", "factory_qwiic", "https://www.adafruit.com/product/1980"),
  readyPart("MFG-ADAFRUIT-4161", "sensor", "proximity_light", "Adafruit VCNL4040 proximity and ambient light sensor #4161", "Adafruit VCNL4040 Proximity and Lux Sensor #4161", "Adafruit", "https://www.adafruit.com/product/4161", "3.3V I2C through the factory-installed STEMMA QT socket.", "factory_qwiic", "https://www.adafruit.com/product/4161", { sourceMarketplace: "Manufacturer direct" }),
  readyPart("B00NAY24KW", "sensor", "waterproof_temperature_probe", "Adafruit waterproof DS18B20 temperature probe #381", "Adafruit Waterproof DS18B20 Digital Temperature Sensor #381", "Adafruit", "https://www.amazon.com/dp/B00NAY24KW", "Factory lead wires terminate in a solderless three-position lever/screw-terminal-to-Dupont adapter; include the required 4.7 kOhm pull-up.", "solderless_terminal_adapter", "https://www.adafruit.com/product/381"),
  readyPart("B07HQ8RGTY", "sensor", "water_flow", "Adafruit YF-S201 plastic water flow sensor #828", "Adafruit Plastic Water Flow Sensor #828", "Adafruit", "https://www.amazon.com/dp/B07HQ8RGTY", "Factory three-wire cable terminates through a keyed no-solder mating cable/terminal adapter.", "solderless_cable_adapter", "https://www.adafruit.com/product/828"),
  readyPart("B0CG2WQGP9", "dev_board", "esp32_2432s028r", "ESP32-2432S028R smart display", "DIYmalls ESP32-2432S028R 2.8-inch resistive-touch smart display", "DIYmalls", "https://www.amazon.com/dp/B0CG2WQGP9", "Use the board's factory JST/GPIO connectors and supplied leads; 3.3V logic only.", "factory_connectors", "https://www.amazon.com/dp/B0CG2WQGP9"),
  readyPart("B0GVF97WTY", "dev_board", "esp32_s3_n16r8", "hiBCTR ESP32-S3 DevKit N16R8", "hiBCTR ESP32-S3 DevKit N16R8 development board", "hiBCTR", "https://www.amazon.com/dp/B0GVF97WTY", "3.3V GPIO; installed-header assembly profile populates both exact 1x22 rows.", "modeled_installed_male_header", "https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide.html"),
  readyPart("B0BVVGNBB3", "dev_board", "esp32_s3_devkitc_n8r2", "AITRIP ESP32-S3 DevKitC-1 N8R2", "AITRIP ESP32-S3 DevKitC-1 N8R2 with headers", "AITRIP", "https://www.amazon.com/dp/B0BVVGNBB3", "3.3V GPIO; installed-header assembly profile populates both exact 1x22 rows.", "modeled_installed_male_header", "https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide.html"),
  readyPart("B0GCLNQW53", "dev_board", "heltec_wifi_lora_32_v4", "Heltec WiFi LoRa 32 V4", "Heltec WiFi LoRa 32 V4 development board", "Heltec", "https://www.amazon.com/dp/B0GCLNQW53", "3.3V GPIO; use the catalog's installed-header assembly form and the exact V4 pin map.", "modeled_installed_male_header", "https://old.heltec.org/project/wifi-lora-32-v4/"),
  readyPart("B0D3BNHDPL", "sensor", "air_quality", "Sensirion SEN55 environmental sensor node", "Sensirion SEN55 Environmental Sensor Node", "Sensirion", "https://www.amazon.com/dp/B0D3BNHDPL", "Factory sensor socket plus the keyed SEN5x mating cable; no soldering at the sensor.", "factory_socket_cable", "https://sensirion.com/products/catalog/SEN55"),
  readyPart("B00NPZ4CPG", "sensor", "load_cell_amplifier", "SparkFun HX711 load-cell amplifier", "SparkFun HX711 Load Cell Amplifier SEN-13879", "SparkFun", "https://www.amazon.com/dp/B00NPZ4CPG", "Installed-header assembly profile populates all exact signal/load-cell holes; power the digital side at the build's validated logic voltage.", "modeled_installed_male_header", "https://github.com/sparkfun/HX711-Load-Cell-Amplifier"),
  readyPart("MFG-SPARKFUN-SEN-15219", "sensor", "pulse_oximeter", "SparkFun MAX30101/MAX32664 pulse oximeter and heart-rate sensor", "SparkFun Pulse Oximeter and Heart Rate Sensor MAX30101/MAX32664 Qwiic SEN-15219", "SparkFun", "https://www.sparkfun.com/sparkfun-pulse-oximeter-and-heart-rate-sensor-max30101-max32664-qwiic.html", "Factory Qwiic handles power/I2C; RESET and MFIO use no-solder IC hooks/pigtails as documented by SparkFun.", "factory_qwiic_ic_hooks", "https://learn.sparkfun.com/tutorials/sparkfun-pulse-oximeter-and-heart-rate-monitor-hookup-guide/hardware-hookup", { sourceMarketplace: "Manufacturer direct" }),
  readyPart("B0F18W86GC", "dev_board", "waveshare_esp32_s3_touch_lcd_2_1", "Waveshare ESP32-S3 2.1-inch round display board", "Waveshare ESP32-S3 Touch LCD 2.1-inch round display board", "Waveshare", "https://www.amazon.com/dp/B0F18W86GC", "Use the exact board's factory FPC/JST/GPIO connector faces; 3.3V GPIO only.", "factory_connectors", "https://docs.waveshare.com/ESP32-S3-Touch-LCD-2.1"),
  restrictedReadyPart("B0FBGFWFB1", "accessory", "esp32_c3_supermini_expansion_board", "AITRIP ESP32-C3 SuperMini expansion board, 2-pack", "AITRIP ESP32-C3 SuperMini Expansion Board (Only Expansion Board, 2PCS)", "AITRIP", "https://www.amazon.com/dp/B0FBGFWFB1", "Factory 2x8 controller sockets, labeled screw terminals, and 3-lane male breakout pins; validate the clone rail/current behavior before power.", "factory_socket_terminal_and_male_breakout_pins", "https://www.amazon.com/dp/B0FBGFWFB1"),
  restrictedReadyPart("B0H336QRXX", "accessory", "esp32_s3_44pin_expansion_board", "AITRIP ESP32-S3 44-pin GPIO 1-to-2 expansion board V2775", "AITRIP ESP32-S3 44-pin GPIO 1-to-2 Expansion Board", "AITRIP", "https://www.amazon.com/dp/B0H336QRXX", "Factory dual 1x22 sockets, replicated male pin banks, DC input, and labeled power banks; validate the V2775 rail/current behavior before power.", "factory_dual_socket_and_male_breakout_pins", "https://www.amazon.com/dp/B0H336QRXX"),
  readyPart("B08P4GPR6M", "accessory", "seeed_xiao_expansion_base", "Seeed Studio Expansion Board Base for XIAO 103030356", "Seeed Studio Expansion Board Base for XIAO", "Seeed Studio", "https://www.amazon.com/dp/B08P4GPR6M", "Factory XIAO sockets, Grove connectors, OLED, RTC, microSD, JST2.0, and 2x4 header; validate the selected XIAO-family pin map.", "factory_xiao_socket_grove_and_header", "https://www.seeedstudio.com/Seeeduino-XIAO-Expansion-board-p-4746.html"),
];

const BINDINGS = {
  "10pcs-max485-rs485-transceiver-module-ttl-serial-to-rs-485-module-b088q8td4v-19": b("B088Q8TD4V", "factory_male_header"),
  "adafruit-apds9960-gesture-breakout-3595": b("B076PVHFBW", "factory_qwiic"),
  "adafruit-as7341-spectral-breakout-4698": b("MFG-ADAFRUIT-4698", "factory_qwiic", "Use the factory STEMMA QT socket; manufacturer-direct exact SKU is the catalog purchase path.", { url: "https://www.adafruit.com/product/4698" }),
  "adafruit-bno055-orientation-breakout-2472": b("B017PEIGIG", "modeled_installed_male_header", "Use the installed-header model revision: exact 1x6 and 1x4 rows at the manufacturer Eagle coordinates.", { geometryProfile: "installed-header-v1" }),
  "adafruit-half-size-breadboard-64": b("MFG-ADAFRUIT-64", "solderless_breadboard", "Exact manufacturer-direct #64 is the catalog purchase path.", { url: "https://www.adafruit.com/product/64" }),
  "adafruit-ina260-current-power-breakout-4226": b("B07S8QYDF8", "factory_qwiic", "Use STEMMA QT for I2C and the installed terminal block for the measured circuit."),
  "adafruit-ltr390-uv-breakout-4831": b("B08XKJRT9T", "factory_qwiic"),
  "adafruit-mcp9600-thermocouple-breakout-4101": b("B07SZ8YVTW", "factory_qwiic", "Use STEMMA QT for I2C and the installed terminal block for the thermocouple."),
  "adafruit-mcp9808-precision-temp-breakout-1782": b("B00OKCQX96", "factory_qwiic", "Use the current exact board revision's factory STEMMA QT socket."),
  "adafruit-pmsa003i-breakout-4632": b("MFG-ADAFRUIT-4632", "factory_jst", "Use the keyed factory JST socket/cable path.", { url: "https://www.adafruit.com/product/4632" }),
  "adafruit-pn532-nfc-breakout-364": b("B00KKUECAO", "modeled_installed_male_header", "Use the installed-header model revision: 1x8 interface plus two 1x3 selector rows.", { geometryProfile: "installed-header-v1" }),
  "adafruit-scd41-co2-breakout-5190": b("B0DYVCTTCD", "factory_qwiic"),
  "adafruit-sgp30-voc-breakout-3709": b("B07L5YN11R", "factory_qwiic"),
  "adafruit-4397-qwiic-to-female-sockets": b("B09WLRBKWT", "factory_crimped_cable", "Use the exact 150 mm factory cable: keyed JST-SH Qwiic plug at the sensor and four individual housed female sockets at verified controller male pins."),
  "adafruit-sht45-temp-humidity-breakout-5665": b("B0DXD7MT5S", "factory_qwiic"),
  "adafruit-sths34pf80-presence-breakout-6426": b("MFG-ADAFRUIT-6426", "factory_qwiic", "Use the factory STEMMA QT socket; manufacturer-direct exact SKU is the catalog purchase path.", { url: "https://www.adafruit.com/product/6426" }),
  "adafruit-tsl2591-hdr-light-breakout-1980": b("B00XW2OFWW", "factory_qwiic", "Use the current exact board revision's factory STEMMA QT socket."),
  "adafruit-vcnl4040-proximity-breakout-4161": b("MFG-ADAFRUIT-4161", "factory_qwiic", "Use the factory STEMMA QT socket; manufacturer-direct exact SKU is the catalog purchase path.", { url: "https://www.adafruit.com/product/4161" }),
  "adafruit-waterproof-ds18b20-probe-381": b("B00NAY24KW", "solderless_terminal_adapter", "Terminate the factory leads in a three-position lever/screw-terminal-to-Dupont adapter; include a 4.7 kOhm pull-up.", { requiredAccessory: "3-position solderless terminal-to-Dupont adapter + 4.7 kOhm pull-up" }),
  "adafruit-yf-s201-water-flow-sensor-828": b("B07HQ8RGTY", "solderless_cable_adapter", "Use a keyed three-wire mating pigtail/terminal adapter; never insert bare leads directly into a breadboard.", { requiredAccessory: "keyed 3-wire mating cable or solderless terminal adapter" }),
  "ads1115-adc": b("B0BXWJFCVJ", "factory_male_header"),
  "adxl345-b0bxwhtxwt-9": b("B0BXWHTXWT", "factory_male_header"),
  "aoicrie-4pcs-esp32-esp32-c3-mini-development-board-pre-soldered": b("B0DD3ZB5XV", "factory_male_header"),
  "bh1750-light": b("B0CN55S7Z9", "factory_male_header"),
  "bme280-gy-bme280": b("B0F9DZBLW9", "factory_male_header"),
  "bmp180-sensor-module": b("B0CDQMFX7S", "factory_male_header"),
  "bmp280-sensor-module": b("B0CD4PQZGQ", "factory_male_header"),
  "buzzer-module": b("B0GW8M3Q3K", "factory_male_header"),
  "dht22-am2302-temp-humidity": b("B0GSR68YH9", "factory_cable"),
  "diyables-capacitive-soil-moisture-tlc555i": b("B0DYDN9RG4", "factory_cable"),
  "diyables-tlc555i-soil-moisture-b0dydn9rg4": b("B0DYDN9RG4", "factory_cable"),
  "esp-wroom-32-multi-pack": b("B08D5ZD528", "factory_male_header"),
  "esp32-0-96-oled-integrated-board": b("B0CN4F354N", "factory_male_header"),
  "esp32-2432s028r-smart-display": b("B0CG2WQGP9", "factory_connectors", "Use the exact board's factory JST/GPIO connector faces and supplied leads."),
  "esp32-c3-mini": b("B0GR8WYC8C", "factory_male_header"),
  "esp32-c5-lcd-dev-board": b("B0H6Z84SSN", "factory_male_header"),
  "esp32-c6-1-3inch-lcd-display-development-board-with-pre-soldered-header": b("B0GJT1X7H5", "factory_male_header"),
  "esp32-c6-1-47inch-ips-touch-display-development-board-with-pre-soldered-header": b("B0F99KMRVL", "factory_male_header"),
  "esp32-c6-rgb-led-display-board": b("B0F4DDDQSM", "factory_male_header"),
  "esp32-camera-board": b("B09ZJTVPNW", "factory_male_header"),
  "esp32-s3-cam-dev-kit-exact-pre-soldered-header-variant": b("B0GSYZTJGX", "factory_male_header"),
  "esp32-s3-devkit-n16r8": b("B0GVF97WTY", "modeled_installed_male_header", "Use the installed-header model revision with both exact 1x22 rows populated.", { geometryProfile: "installed-header-v1" }),
  "esp32-s3-devkitc-1-n8r2": b("B0BVVGNBB3", "modeled_installed_male_header", "Use the installed-header model revision with both exact 1x22 rows populated.", { geometryProfile: "installed-header-v1" }),
  "esp32-s3-wroom-n16r8-camera-board": b("B0HBP9HLW9", "factory_male_header"),
  "esp32-wroom-32-classic-dev-board": b("B0D8T53CQ5", "factory_male_header"),
  "fs90r-paired-wheel-kit": b("B086ZGTLZB", "factory_servo_plug"),
  "fs90r-single-servo": b("ALI-3256807557711270", "factory_servo_plug"),
  "gy-302-bh1750": b("B0CN55S7Z9", "factory_male_header"),
  "gy-bme280": b("B0F9DZBLW9", "factory_male_header"),
  "hall-effect-magnetic-sensor": b("B0FB8P22H4", "factory_male_header"),
  "hc-sr04p-ultrasonic-distance": b("B09NNKJM2H", "factory_male_header"),
  "heltec-wifi-lora-32-v4": b("B0GCLNQW53", "modeled_installed_male_header", "The approved assembly form uses the existing installed-header GLB and exact V4 pin map.", { geometryProfile: "existing-installed-header" }),
  "hibctr-4-pack-neo-7m-gps-module-sma-antenna-pre-soldered-headers-b0fnd6jn5s-27": b("B0FND6JN5S", "factory_male_header"),
  "hlk-ld2410c-radar": b("B0F25WTY1W", "factory_male_header"),
  "joystick-module": b("B0BFQTLM5T", "factory_male_header"),
  "keypad-4x4": b("B0G6YRQJ5F", "factory_male_header"),
  "ky-040-rotary-encoder": b("B0GX88M8ML", "factory_male_header"),
  "l76k-gnss": b("B0FJLXZ3J9", "factory_male_header"),
  "lcd1602-keypad": b("B0F1L7FG5Z", "factory_male_header"),
  "led-traffic-light-module": b("B0BXKKT9JH", "factory_male_header"),
  "microphone-sound-detector": b("B0CN583K69", "factory_male_header"),
  "mpu6050-b0bmy15tc4-8": b("B0BMY15TC4", "factory_male_header"),
  "neo-6m-gps-module": b("B0F2DKWJ4J", "factory_male_header"),
  "rain-water-level": b("B09J2NK21Y", "factory_male_header"),
  "reed-switch-magnetic-sensor": b("B0FR4CNLPX", "factory_male_header"),
  "rgb-led-module": b("B0BXKMGSG6", "factory_male_header"),
  "seeed-xiao-esp32c3": b("B0DRNSV5CS", "factory_male_header"),
  "seeed-xiao-esp32c5": b("B0GWPZR8C6", "factory_male_header"),
  "seeed-xiao-esp32c6": b("B0DRNW9LJM", "factory_male_header"),
  "seeed-xiao-esp32s3": b("B0DRNVH8MQ", "factory_male_header"),
  "sensirion-sen55": b("B0D3BNHDPL", "factory_socket_cable", "Use the keyed SEN5x mating cable at the factory socket.", { requiredAccessory: "Sensirion SEN5x keyed mating cable" }),
  "sparkfun-hx711-load-cell-amplifier-sen-13879": b("B00NPZ4CPG", "modeled_installed_male_header", "Use the installed-header model revision with all exact signal and load-cell holes populated.", { geometryProfile: "installed-header-v1" }),
  "sparkfun-max30101-max32664-pulse-oximeter-sen-15219": b("MFG-SPARKFUN-SEN-15219", "factory_qwiic_ic_hooks", "Use Qwiic for power/I2C and no-solder IC hooks/pigtails for RESET and MFIO.", { url: "https://www.sparkfun.com/sparkfun-pulse-oximeter-and-heart-rate-sensor-max30101-max32664-qwiic.html", requiredAccessory: "Qwiic cable + two IC hooks/pigtails" }),
  "aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1": b("B0FBGFWFB1", "factory_socket_terminal_and_male_breakout_pins", "Use only with the exact 16-pin ESP32-C3 SuperMini footprint; require the immutable 2x8 USB-C-toward-power-block mount contract and controller-USB-C/3.3V-only restricted power contract.", { approvalBasis: "user_requested_publication_2026-08-28", geometryProfile: "source-backed-photo-calibrated-factory-connectors-v1", electricalNote: "Controller USB-C power and factory-default 3.3V peripheral rails only; no external carrier power, battery connection, rail modification, or GPIO-sourced sensor load." }),
  "aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx": b("B0H336QRXX", "factory_dual_socket_and_male_breakout_pins", "Use only with the exact 44-pin ESP32-S3 DevKitC footprint; require the immutable 2x22 USB-C-aligned-with-carrier-arrow mount contract and controller-USB-C/3.3V-only restricted power contract.", { approvalBasis: "user_requested_publication_2026-08-28", geometryProfile: "source-backed-photo-calibrated-factory-connectors-v1", electricalNote: "Controller USB-C power and 3.3V peripheral rows only; no external carrier power, DC barrel input, 5V peripheral rail, or family substitution." }),
  "seeed-xiao-expansion-base-103030356": b("B08P4GPR6M", "factory_xiao_socket_grove_and_header", "Seat a supported XIAO board in the factory sockets and validate that XIAO family's published pin map.", { approvalBasis: "user_requested_publication_2026-08-28", geometryProfile: "manufacturer-ecad-derived-post-pcn-factory-connectors-v1", electricalNote: "The XIAO interface geometry is assembly-ready, but validate the selected XIAO family pin functions, 3.3V logic, battery polarity, and peripheral current before power." }),
  "sparkfun-qwiic-compatible-with-micro-bit-breakout-with-headers": b("B098ZQ4V52", "factory_male_header"),
  "ssd1306-091-oled": b("B0DSL8CPD9", "factory_male_header"),
  "ssd1306-096-oled-blue": b("B0DG8JZ2TT", "factory_male_header", "The asset slug is stale: exact evidence binds this GLB to the 0.91-inch blue-screen variant."),
  "ssd1306-096-oled-white": b("B0DG8KYSPH", "factory_male_header", "The asset slug is stale: exact evidence binds this GLB to the 0.91-inch white-screen variant."),
  "ssd1309-242-oled": b("B0GZHW1KD4", "factory_male_header"),
  "st7789-225-tft-display-module": b("B0H6P19FQ7", "factory_male_header"),
  "tft-154-lcd-display-module": b("B0H2HL5ZQY", "factory_male_header"),
  "thing-plus-esp32": b("B0BC29D9QG", "factory_male_header"),
  "ttp223-touch": b("B0BPG115T1", "factory_male_header"),
  "vibration-motor-module-3-pcs-dc5v-9000rpm-for-diy-projects": b("B08GPMCP7J", "factory_male_header"),
  "vl53l1x-tof": b("B0GZP9DQJ5", "factory_male_header"),
  "waveshare-esp32-c6-lcd-1_47-m": b("B0DHTMYTCY", "factory_male_header"),
  "waveshare-esp32-s3-1-91-amoled-display-board": b("B0DJX8J1JK", "factory_male_header"),
  "waveshare-esp32-s3-2-1-round-display-board": b("B0F18W86GC", "factory_connectors", "Use the exact board's modeled factory FPC/JST/GPIO connector faces."),
  "waveshare-esp32-s3-eth-ov5640-camera-board": b("B0H5PXC6GM", "factory_connectors"),
};

const USER_APPROVED_ASSETS = new Set([
  "10pcs-max485-rs485-transceiver-module-ttl-serial-to-rs-485-module-b088q8td4v-19",
  "adafruit-as7341-spectral-breakout-4698",
  "adafruit-bno055-orientation-breakout-2472",
  "adafruit-half-size-breadboard-64",
  "adafruit-ina260-current-power-breakout-4226",
  "adafruit-mcp9600-thermocouple-breakout-4101",
  "adafruit-mcp9808-precision-temp-breakout-1782",
  "adafruit-pmsa003i-breakout-4632",
  "adafruit-pn532-nfc-breakout-364",
  "adafruit-sths34pf80-presence-breakout-6426",
  "adafruit-tsl2591-hdr-light-breakout-1980",
  "adafruit-vcnl4040-proximity-breakout-4161",
  "adafruit-waterproof-ds18b20-probe-381",
  "adafruit-yf-s201-water-flow-sensor-828",
  "buzzer-module",
  "esp32-2432s028r-smart-display",
  "esp32-s3-devkit-n16r8",
  "esp32-s3-devkitc-1-n8r2",
  "hall-effect-magnetic-sensor",
  "heltec-wifi-lora-32-v4",
  "sensirion-sen55",
  "sparkfun-hx711-load-cell-amplifier-sen-13879",
  "sparkfun-max30101-max32664-pulse-oximeter-sen-15219",
  "vibration-motor-module-3-pcs-dc5v-9000rpm-for-diy-projects",
  "waveshare-esp32-s3-2-1-round-display-board",
]);

async function main() {
  const verifiedPath = path.join(ROOT, "lib/verified-parts-catalog.csv");
  const rootPath = path.join(ROOT, "makeable-amazon-aliexpress-iot-catalog.csv");
  const verified = parseCsv(await readFile(verifiedPath, "utf8"));
  appendObjects(verified, ADDITIONS);
  await writeCsv(verifiedPath, verified);
  await writeFile(path.join(ROOT, "lib/verified-parts-catalog-data.mjs"), `export default ${JSON.stringify(toCsv(verified))};\n`);

  const rootCatalog = parseCsv(await readFile(rootPath, "utf8"));
  appendRootRows(rootCatalog, ADDITIONS);
  await writeCsv(rootPath, rootCatalog);

  const pointer = await fetchJson(`${POINTER_URL}?cb=${Date.now()}`);
  const manifest = await fetchJson(`${pointer.manifestUrl}?cb=${Date.now()}`);
  const review = await fetchJson(`${pointer.reviewUrl}?cb=${Date.now()}`);
  if (manifest.assets?.length !== pointer.assetCount || review.decisions?.length !== pointer.assetCount) {
    throw new Error(`Registry count mismatch: pointer=${pointer.assetCount}, manifest=${manifest.assets?.length}, review=${review.decisions?.length}`);
  }
  const manifestIds = new Set(manifest.assets.map((asset) => asset.partId));
  const reviewIds = new Set(review.decisions.map((decision) => decision.assetId));
  if (manifestIds.size !== pointer.assetCount || reviewIds.size !== pointer.assetCount) {
    throw new Error("Registry manifest or review contains duplicate asset ids");
  }
  const manifestWithoutReview = [...manifestIds].filter((partId) => !reviewIds.has(partId));
  const reviewWithoutManifest = [...reviewIds].filter((partId) => !manifestIds.has(partId));
  if (manifestWithoutReview.length || reviewWithoutManifest.length) {
    throw new Error(`Registry review set mismatch: missing=${manifestWithoutReview.join("|")} orphaned=${reviewWithoutManifest.join("|")}`);
  }

  const header = verified[0];
  const verifiedAsins = new Set(verified.slice(1).map((row) => row[header.indexOf("asin")]).filter(Boolean));
  const reviewById = new Map(review.decisions.map((item) => [item.assetId, item]));
  const rows = [[
    "assembly_asset_id", "assembly_asset_name", "registry_revision", "assembly_revision", "glb_url", "glb_sha256",
    "review_state", "catalog_asin_or_key", "catalog_binding", "connector_readiness",
    "selection_status", "selection_blocker", "connection_requirement", "required_accessory", "approval_basis",
    "sold_form_geometry", "electrical_note", "review_evidence_url", "marketplace_url", "last_checked_yyyy_mm_dd",
  ]];

  for (const asset of manifest.assets) {
    const binding = BINDINGS[asset.partId];
    if (!binding) throw new Error(`Missing catalog binding for AWS asset ${asset.partId}`);
    const decision = reviewById.get(asset.partId);
    if (!decision) throw new Error(`Missing exact review decision for ${asset.partId}`);
    if (decision.reviewedSha256 !== asset.sha256) {
      throw new Error(`Review/model hash mismatch for ${asset.partId}`);
    }
    const catalogBinding = binding.key
      ? (verifiedAsins.has(binding.key) || binding.key.startsWith("ALI-") ? "verified_catalog" : "exact_marketplace_blocked")
      : "no_exact_marketplace_listing";
    let selectionStatus = asset.selectionStatus || "ready";
    let blocker = asset.selectionBlocker || "";
    if (decision.state !== "visual_ready" && !blocker) blocker = decision.reason;
    rows.push([
      asset.partId, asset.name, manifest.revision, asset.revision, asset.url, asset.sha256, decision.state,
      binding.key, catalogBinding, binding.connector, selectionStatus, blocker,
      binding.note, binding.requiredAccessory,
      USER_APPROVED_ASSETS.has(asset.partId) ? "user_approved_2026-08-27" : binding.approvalBasis,
      binding.geometryProfile, binding.electricalNote,
      decision.freshWebglRender?.url || asset.reviewEvidenceUrl || "", binding.url || marketplaceUrl(binding.key),
      asset.approvalBasis === "user_requested_publication_2026-08-28" ? "2026-08-28" : CHECKED_DATE,
    ]);
  }

  const unknownBindings = Object.keys(BINDINGS).filter((id) => !manifest.assets.some((asset) => asset.partId === id));
  if (unknownBindings.length) throw new Error(`Bindings not present in active AWS registry: ${unknownBindings.join(", ")}`);
  const crosswalkPath = path.join(ROOT, "lib/assembly-asset-catalog.csv");
  await writeCsv(crosswalkPath, rows);
  await writeFile(path.join(ROOT, "lib/assembly-asset-catalog-data.mjs"), `export default ${JSON.stringify(toCsv(rows))};\n`);
  console.log(JSON.stringify({
    revision: manifest.revision,
    assets: rows.length - 1,
    ready: rows.slice(1).filter((row) => row[10] === "ready").length,
    blocked: rows.slice(1).filter((row) => row[10] !== "ready").length,
    verifiedCatalogRows: verified.length - 1,
  }, null, 2));
}

function readyPart(asin, category, subtype, name, listingTitle, brand, url, notes, connectionType, evidenceUrl, options = {}) {
  const isCable = category === "connector";
  const assetBound = options.assetBound !== false;
  return {
    source_marketplace: options.sourceMarketplace || "Amazon",
    category,
    subcategory_or_subtype: subtype,
    part_name: name,
    listing_title: listingTitle,
    brand_or_seller: brand,
    estimated_price_usd: "",
    pack_qty: String(options.packQty || 1),
    asin,
    direct_url: url,
    esp32_voltage: notes,
    current_or_power_notes: notes,
    why_include: assetBound
      ? `${connectionType.startsWith("modeled_") ? "User-approved" : "Exact no-solder"} ${connectionType.replaceAll("_", " ")} variant with a visually reviewed AWS GLB.`
      : `Exact no-solder ${connectionType.replaceAll("_", " ")} path for plug-ready catalog assemblies.`,
    exclusion_flags: isCable ? "connector_exception_no_user_soldering_or_crimping" : "",
    visual_status: "visual_PASS",
    verification_status: assetBound
      ? `visual_PASS_${connectionType}_aws_glb_bound`
      : `visual_PASS_${connectionType}_assembly_path`,
    last_checked_yyyy_mm_dd: CHECKED_DATE,
    factory_presoldered_male_pins_verified: connectionType === "factory_male_header" ? "yes" : `exception_${connectionType}`,
    exact_qualifying_variant: `${listingTitle} / ${asin}`,
    visual_pass_evidence: assetBound
      ? `AWS four-angle review passed for the exact catalog-bound GLB; sold connection form is ${connectionType.replaceAll("_", " ")}.`
      : `Exact factory-assembled connection path verified; sold connection form is ${connectionType.replaceAll("_", " ")}.`,
    pin_source_evidence: evidenceUrl,
    source_metadata_file: assetBound ? "approved-visual-catalog-20260828-recovered-v1" : "exact marketplace/manufacturer evidence",
    visual_gate_file: assetBound ? "AWS review manifest + exact marketplace/manufacturer evidence" : "exact product image + connector specification",
    source_confidence: "high",
    lipo_jst_charger_notes: "",
    source_loop: "aws-catalog-reconciliation",
    source_file: "live Amazon/manufacturer evidence",
    source_row: "",
    join_source: assetBound ? "exact ASIN/SKU to AWS asset id" : "exact connection accessory ASIN",
    reconciliation_note: connectionType.startsWith("modeled_")
      ? "User-approved installed-header assembly profile; the model must not be presented as proof that every marketplace unit ships with soldered headers."
      : "Approved connection path requires no user soldering or crimping.",
  };
}

function restrictedReadyPart(asin, category, subtype, name, listingTitle, brand, url, notes, connectionType, evidenceUrl) {
  const isC3 = asin === "B0FBGFWFB1";
  return {
    source_marketplace: "Amazon",
    category,
    subcategory_or_subtype: subtype,
    part_name: name,
    listing_title: listingTitle,
    brand_or_seller: brand,
    estimated_price_usd: "",
    pack_qty: asin === "B0FBGFWFB1" ? "2" : "1",
    asin,
    direct_url: url,
    esp32_voltage: notes,
    current_or_power_notes: notes,
    why_include: "Exact factory-assembled breakout/carrier with an immutable, visually approved AWS GLB; production selectable only under its deterministic mount and restricted-power contracts.",
    exclusion_flags: "restricted_ready_requires_contract",
    visual_status: "visual_PASS",
    verification_status: `visual_PASS_restricted_READY_${connectionType}_aws_glb_bound`,
    last_checked_yyyy_mm_dd: "2026-08-28",
    factory_presoldered_male_pins_verified: `exception_${connectionType}`,
    exact_qualifying_variant: `${listingTitle} / ${asin}`,
    visual_pass_evidence: `Markings, pins, connectors, outline, scale, and populated assembly passed; selection requires the exact ${isC3 ? "2x8 mount and controller-USB-C/3.3V-only" : "2x22 mount and controller-USB-C/3.3V-only"} power contracts.`,
    pin_source_evidence: evidenceUrl,
    source_metadata_file: "approved-visual-catalog-20260829-breakout-restricted-power-v6",
    visual_gate_file: "hash-bound visual-pass review + exact marketplace/manufacturer evidence",
    source_confidence: "high_with_documented_limitations",
    lipo_jst_charger_notes: "",
    source_loop: "aws-catalog-reconciliation",
    source_file: "live Amazon/manufacturer evidence",
    source_row: "",
    join_source: "exact ASIN/SKU to AWS restricted-ready asset id",
    reconciliation_note: isC3
      ? "Restricted-ready: exact C3 family, 2x8 seating, controller USB-C power, factory-default 3.3V rails, no battery, and no rail modification."
      : "Restricted-ready: exact 44-pin S3 family, 2x22 seating, controller USB-C power, 3.3V sensor rows, no DC barrel, and no 5V sensor rail.",
  };
}

function b(key, connector, note = "", options = {}) {
  return {
    key,
    connector,
    note,
    requiredAccessory: options.requiredAccessory || "",
    approvalBasis: options.approvalBasis || "verified_exact_connection",
    geometryProfile: options.geometryProfile || "existing_reviewed_geometry",
    electricalNote: options.electricalNote || electricalNoteFor(connector, key),
    url: options.url || "",
  };
}

function electricalNoteFor(connector, key) {
  if (key === "B088Q8TD4V") return "Power VCC from the validated module rail; GPIO pins carry logic only. Validate 3.3V logic compatibility before wiring the exact MAX485 module.";
  if (key === "B0GW8M3Q3K") return "Power VCC from the specified board rail; the GPIO drives only the signal/input pin.";
  if (key === "B0FB8P22H4") return "Power the Hall module from the validated 3.3V rail; the GPIO reads the signal/output pin.";
  if (key === "B08GPMCP7J") return "Power the motor module from the 5V board rail; the GPIO drives only IN. Never power the motor from a GPIO pin.";
  if (/qwiic|stemma/.test(connector)) return "Use the 3.3V I2C bus unless the exact board documentation explicitly specifies otherwise.";
  return "The assembly generator must validate rail voltage, polarity, signal direction, and ESP32 pin capability before emitting wiring.";
}

function marketplaceUrl(key) {
  if (/^B0[A-Z0-9]{8}$/.test(key) || /^B[A-Z0-9]{9}$/.test(key)) return `https://www.amazon.com/dp/${key}`;
  if (key === "ALI-3256807557711270") return "https://www.aliexpress.us/item/3256807557711270.html";
  if (key === "MFG-ADAFRUIT-4698") return "https://www.adafruit.com/product/4698";
  if (key === "MFG-ADAFRUIT-64") return "https://www.adafruit.com/product/64";
  if (key === "MFG-ADAFRUIT-4632") return "https://www.adafruit.com/product/4632";
  if (key === "MFG-ADAFRUIT-6426") return "https://www.adafruit.com/product/6426";
  if (key === "MFG-ADAFRUIT-4161") return "https://www.adafruit.com/product/4161";
  if (key === "MFG-SPARKFUN-SEN-15219") return "https://www.sparkfun.com/sparkfun-pulse-oximeter-and-heart-rate-sensor-max30101-max32664-qwiic.html";
  return "";
}

function appendObjects(table, objects) {
  const header = table[0];
  const asinIndex = header.indexOf("asin");
  const sourceLoopIndex = header.indexOf("source_loop");
  const existing = new Map(table.slice(1).map((row, index) => [row[asinIndex], index + 1]).filter(([asin]) => asin));
  for (const object of objects) {
    const generatedRow = header.map((key) => object[key] ?? "");
    const existingIndex = existing.get(object.asin);
    if (existingIndex != null) {
      if (table[existingIndex][sourceLoopIndex] === "aws-catalog-reconciliation") table[existingIndex] = generatedRow;
      continue;
    }
    table.push(generatedRow);
    existing.set(object.asin, table.length - 1);
  }
}

function appendRootRows(table, additions) {
  const header = table[0];
  const familyIndex = header.indexOf("part_family");
  const noteIndex = header.indexOf("allowlist_note");
  const existing = new Map(table.slice(1).map((row, index) => [row[familyIndex], index + 1]));
  for (const part of additions) {
    const object = {
      bucket: rootBucket(part.category),
      part_family: part.part_name,
      amazon_example: part.listing_title,
      amazon_query_or_buy_url: part.direct_url,
      aliexpress_query_or_buy_url: "",
      allowlist_note: part.source_metadata_file === "approved-visual-catalog-20260828-recovered-v1"
        ? `exact no-solder ${part.factory_presoldered_male_pins_verified}; AWS GLB bound by exact ASIN`
        : `exact no-solder ${part.factory_presoldered_male_pins_verified}; verified connection accessory`,
    };
    const generatedRow = header.map((key) => object[key] ?? "");
    const existingIndex = existing.get(part.part_name);
    if (existingIndex != null) {
      if (/AWS GLB bound by exact ASIN|verified connection accessory/.test(table[existingIndex][noteIndex])) table[existingIndex] = generatedRow;
      continue;
    }
    table.push(generatedRow);
    existing.set(part.part_name, table.length - 1);
  }
}

function rootBucket(category) {
  if (category === "dev_board") return "esp32_board";
  if (category === "connector") return "accessory";
  return category;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json", "Cache-Control": "no-cache" } });
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
  return response.json();
}

async function writeCsv(file, table) {
  await writeFile(file, toCsv(table));
}

function toCsv(table) {
  return `${table.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((candidate, index) => index === 0 || candidate.some(Boolean));
}

await main();

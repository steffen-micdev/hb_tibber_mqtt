const mqtt = require("mqtt");
const smartmeter = require("smartmeter-obis");

let hap;

module.exports = (api) => {
  hap = api.hap;
  api.registerAccessory("SmartMeterMQTT", SmartMeterMQTT);
};

class SmartMeterMQTT {
  constructor(log, config, api) {
    this.log = log;
    this.api = api;

    // Config
    this.name = config.name || "Smart Meter";
    this.mqttUrl = config.mqttUrl || "mqtt://localhost";
    this.topic = config.topic || "smartmeter/raw";

    // HomeKit Services
    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, "SmartMeter")
      .setCharacteristic(hap.Characteristic.Model, "MQTT-SML");

    this.energyService = new hap.Service.Outlet(this.name);
    this.energyService
      .getCharacteristic(hap.Characteristic.On)
      .onGet(() => false); // Dummy, always off

    // Eve custom characteristics
    this.EveCurrentConsumption = this.makeCharacteristic("EvePower", "float", "W");
    this.EveTotalConsumption = this.makeCharacteristic("EveTotalConsumption", "float", "kWh");

    this.energyService.addCharacteristic(this.EveCurrentConsumption);
    this.energyService.addCharacteristic(this.EveTotalConsumption);

    // MQTT
    this.client = mqtt.connect(this.mqttUrl);
    this.client.on("connect", () => {
      this.log("Connected to MQTT broker:", this.mqttUrl);
      this.client.subscribe(this.topic);
    });

    this.client.on("message", (topic, message) => {
      this.handleMessage(message);
    });
  }

  makeCharacteristic(name, format, unit) {
    const UUID = hap.uuid.generate(name);
    const char = function() {
      hap.Characteristic.call(this, name, UUID);
      this.setProps({
        format: format,
        unit: unit,
        perms: [hap.Characteristic.Perms.READ, hap.Characteristic.Perms.NOTIFY]
      });
      this.value = this.getDefaultValue();
    };
    hap.util.inherits(char, hap.Characteristic);
    return new char();
  }

  handleMessage(message) {
    try {
      const buffer = Buffer.from(message);

      smartmeter.process(buffer, (err, result) => {
        if (err) {
          this.log("SML parse error:", err);
          return;
        }

        if (result && result.obis) {
          const power = result.obis["1-0:16.7.0*255"]?.value; // W
          const energy = result.obis["1-0:1.8.0*255"]?.value; // kWh

          if (power !== undefined) {
            this.log("Power:", power, "W");
            this.EveCurrentConsumption.updateValue(power);
          }

          if (energy !== undefined) {
            this.log("Energy:", energy, "kWh");
            this.EveTotalConsumption.updateValue(energy);
          }
        }
      });
    } catch (e) {
      this.log("Error handling message:", e);
    }
  }

  getServices() {
    return [this.informationService, this.energyService];
  }
}

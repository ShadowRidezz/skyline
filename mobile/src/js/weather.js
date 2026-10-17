// Weather on the phone, the same as the PC's Home widget (renderer/js/widgets.js): Open-Meteo, free, no account.
// Your city (searched, or this phone's location) and °F/°C are saved on this phone.
const store = { get(k, d) { try { const v = localStorage.getItem("sky-" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("sky-" + k, JSON.stringify(v)); } catch (e) {} } };

// the PC's weather icons and names, so both look the same
const WICON = {
  sun: `<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>`,
  moon: `<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>`,
  partday: `<circle cx="8.5" cy="8.5" r="3.2"/><path d="M8.5 2.5v1.4M3.2 8.5h1.4M4.7 4.7l1 1M12.3 4.7l-1 1"/><path d="M9 19h9a3.5 3.5 0 0 0 .5-6.97A4.8 4.8 0 0 0 9.3 11.4 3.8 3.8 0 0 0 9 19z"/>`,
  partnight: `<path d="M12.5 8.2A4.5 4.5 0 1 1 7 3a3.6 3.6 0 0 0 5.5 5.2z"/><path d="M9 19h9a3.5 3.5 0 0 0 .5-6.97A4.8 4.8 0 0 0 9.3 11.4 3.8 3.8 0 0 0 9 19z"/>`,
  cloud: `<path d="M7 18.5h10a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.1 9.6 4.5 4.5 0 0 0 7 18.5z"/>`,
  rain: `<path d="M7 15.5h10a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.1 6.6 4.5 4.5 0 0 0 7 15.5z"/><path d="M8.5 18.5l-1 2.5M12.5 18.5l-1 2.5M16.5 18.5l-1 2.5"/>`,
  snow: `<path d="M7 15h10a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.1 6.1 4.5 4.5 0 0 0 7 15z"/><path d="M8 19h.01M12 20.5h.01M16 19h.01M10 22h.01M14 22h.01" stroke-width="2.6"/>`,
  storm: `<path d="M7 15h10a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.1 6.1 4.5 4.5 0 0 0 7 15z"/><path d="M12.5 15.5l-2 3.5h3l-2 3.5"/>`,
  fog: `<path d="M4 9h16M6 13h12M4 17h16"/>`,
  pin: `<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>`,
};
export const wicon = (k, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${WICON[k] || WICON.cloud}</svg>`;
export function wmo(code, day) {
  if (code === 0) return ["Clear", day ? "sun" : "moon"];
  if (code <= 2) return [code === 1 ? "Mostly clear" : "Partly cloudy", day ? "partday" : "partnight"];
  if (code === 3) return ["Cloudy", "cloud"];
  if (code === 45 || code === 48) return ["Fog", "fog"];
  if (code >= 51 && code <= 57) return ["Drizzle", "rain"];
  if (code >= 61 && code <= 67) return ["Rain", "rain"];
  if (code >= 71 && code <= 77) return ["Snow", "snow"];
  if (code >= 80 && code <= 82) return ["Showers", "rain"];
  if (code === 85 || code === 86) return ["Snow showers", "snow"];
  if (code >= 95) return ["Thunderstorm", "storm"];
  return ["—", "cloud"];
}

export const Weather = {
  data: null, at: 0, key: "", failed: false, onChange: null,
  settings() { return { city: null, units: /^en-US|^en$/i.test(navigator.language || "") ? "f" : "c", show: true, ...store.get("wx", {}) }; },
  set(k, v) { store.set("wx", { ...this.settings(), [k]: v }); this.load(true); },
  // fresh weather every 15 minutes (or right away after the city or units change)
  async load(force) {
    const s = this.settings(); if (!s.city) { if (this.data) { this.data = null; this.key = ""; this.onChange && this.onChange(); } return; }
    const key = JSON.stringify([s.city.lat, s.city.lon, s.units]);
    if (!force && key === this.key && Date.now() - this.at < 15 * 60e3) return;
    if (key !== this.key) this.data = null;
    this.key = key; this.at = Date.now();
    const c = s.units === "c";
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${s.city.lat}&longitude=${s.city.lon}`
        + `&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m,precipitation`
        + `&hourly=temperature_2m,weather_code,is_day,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max`
        + `&timezone=auto&forecast_days=6&temperature_unit=${c ? "celsius" : "fahrenheit"}&wind_speed_unit=${c ? "kmh" : "mph"}`;
      const r = await fetch(u); if (!r.ok) throw new Error();
      this.data = await r.json(); this.failed = false;
    } catch (e) { this.at = Date.now() - 13 * 60e3; this.failed = true; }   // (try again in a couple of minutes)
    this.onChange && this.onChange();
  },
  async search(q) {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`);
    return ((await r.json()).results || []).map(c => ({ name: c.name, region: [c.admin1, c.country].filter(Boolean).join(", "), lat: c.latitude, lon: c.longitude }));
  },
  // this phone's location (it asks first); the name comes from the nearest place Open-Meteo knows
  locate() {
    return new Promise((ok, no) => {
      if (!navigator.geolocation) return no(new Error("This phone can't share its location here."));
      navigator.geolocation.getCurrentPosition(async p => {
        const lat = +p.coords.latitude.toFixed(3), lon = +p.coords.longitude.toFixed(3);
        let name = "My location", region = "";
        try { const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`), j = await r.json();
          name = j.city || j.locality || name; region = [j.principalSubdivision, j.countryName].filter(Boolean).join(", "); } catch (e) {}
        ok({ name, region, lat, lon, here: true });
      }, e => no(new Error(e.code === 1 ? "Location is off for Skyline. Search for your city instead." : "Couldn't find where you are. Search for your city instead.")), { timeout: 12000, maximumAge: 30 * 60e3 });
    });
  },
};

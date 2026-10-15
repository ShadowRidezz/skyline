// Paint the last theme's colours before anything else, so Skyline never flashes the wrong look.
try { const v = JSON.parse(localStorage.getItem("sky-ui-vars")); if (v) for (const k in v) document.documentElement.style.setProperty(k, v[k]); } catch (e) {}

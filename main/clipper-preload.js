// The hidden clip recorder's only door to Skyline: get the screen to record, say whether it's recording, hand over a clip.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("clipper", {
  config: () => ipcRenderer.invoke("clipper:config"),
  state: on => ipcRenderer.invoke("clipper:state", on),
  write: (buf, ext, secs) => ipcRenderer.invoke("clipper:write", buf, ext, secs),
  onSave: fn => ipcRenderer.on("clipper:save", () => fn()),
});

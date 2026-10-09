---
'@csg/engine': patch
---

The character renderer now reports GPU device loss (REQ-PIX-036, REQ-UX-046): `GPUDevice.lost` on WebGPU (not when the reason is `destroyed`) and `webglcontextlost` on WebGL2 call `onError` once with `PIX_DEVICE_LOST` (`details: {backend, reason}`). After a loss the renderer is inert: draws and ticks are no-ops, `resume()` returns false, exports and `readCell()` fail with `PIX_DEVICE_LOST` without a partial result, and `dispose()` is safe. A normal `dispose()` reports nothing. New exports: `PIX_DEVICE_LOST`, `watchDeviceLoss`, `WatchDeviceLossOptions`, and the `DeviceLostDetails` type.

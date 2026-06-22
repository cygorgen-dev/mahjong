// Preload all tile PNGs and populate the shared _imgCache so ui.js
// never hits the fallback-then-swap branch.
window._imgCache = window._imgCache || {};

const _preloadStore = [];  // keep references alive so browser won't GC before load

function _preload(path) {
  const img = new Image();
  img.onload  = () => { window._imgCache[path] = true; };
  img.onerror = () => { window._imgCache[path] = false; };
  img.src = path;
  _preloadStore.push(img);
}

['bamboo', 'circle', 'char'].forEach(s => {
  for (let n = 1; n <= 9; n++) _preload(`img/tiles/${s}_${n}.png`);
});

['East', 'South', 'West', 'North'].forEach(w => _preload(`img/tiles/wind_${w}.png`));
['red', 'green', 'white'].forEach(d => _preload(`img/tiles/dragon_${d}.png`));

for (let i = 0; i <= 3; i++) {
  _preload(`img/tiles/flower_${i}.png`);
  _preload(`img/tiles/season_${i}.png`);
}

['bamboo', 'circle', 'char'].forEach(s => {
  for (let n = 1; n <= 9; n++) _preload(`img/tiles-n/${s}_${n}.png`);
});

['East', 'South', 'West', 'North'].forEach(w => _preload(`img/tiles-n/wind_${w}.png`));
['red', 'green', 'white'].forEach(d => _preload(`img/tiles-n/dragon_${d}.png`));

for (let i = 0; i <= 3; i++) {
  _preload(`img/tiles-n/flower_${i}.png`);
  _preload(`img/tiles-n/season_${i}.png`);
}

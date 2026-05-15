// Snappy Matrix — seed Google review counts for week of 2026-05-11
// Decision: option_b_drop_ben_johnson  |  Source: snappy_reviews_attributed_2026-05-15.json
// Paste into the matrix browser console (F12) and press Enter.
(function(){
  var ws = '2026-05-11';
  var rows = [
    // [techShort, weekReviews, monthReviews]
    ['daniel', 5, 12],
    ['dewone', 2,  8],
    ['benji',  0,  4],
    ['nick',   2,  2],
    ['chris',  0,  0],
    ['dee',    0,  0]
  ];
  rows.forEach(function(r){
    window.ipServiceTechSetField(ws, r[0], 'weekReviews',  r[1]);
    window.ipServiceTechSetField(ws, r[0], 'monthReviews', r[2]);
  });
  if (typeof renderInstallPay === 'function') renderInstallPay();
  console.log('[snappy] Seeded reviews for week ' + ws + ':', rows);
})();

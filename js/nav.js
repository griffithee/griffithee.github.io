/* Mark the active nav link based on current page */
(function () {
  const path = window.location.pathname.replace(/\/$/, '') || '/index.html';
  document.querySelectorAll('.nav-links a').forEach(a => {
    const href = a.getAttribute('href').replace(/\/$/, '') || '/index.html';
    if (path === href || path.endsWith(href)) {
      a.classList.add('active');
    }
  });
})();

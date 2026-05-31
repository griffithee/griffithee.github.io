/* Mark the active nav link based on current page */
(function () {
  const path = window.location.pathname.replace(/\/$/, '') || '/index.html';
  document.querySelectorAll('.nav-links a').forEach(a => {
    const rawHref = a.getAttribute('href') || '';
    const href = rawHref.replace(/\/$/, '') || '/index.html';
    if (path === href || path.endsWith(href)) {
      a.classList.add('active');
    }
  });
})();

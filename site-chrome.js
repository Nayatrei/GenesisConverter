// The footer is static HTML; only the calendar year needs client-side sync.
document.querySelectorAll('[data-footer-year]').forEach((node) => {
    node.textContent = String(new Date().getFullYear());
});

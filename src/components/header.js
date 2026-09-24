function renderHeader(title) {
    const header = document.createElement('header');
    const h1 = document.createElement('h1');
    h1.textContent = title;
    header.appendChild(h1);
    return header;
}

module.exports = { renderHeader };

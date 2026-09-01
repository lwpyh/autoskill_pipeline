// Copy BibTeX to clipboard
function copyBibTeX() {
    const bibtexElement = document.getElementById('bibtex-code');
    const button = document.querySelector('.copy-bibtex-btn');
    const copyText = button ? button.querySelector('.copy-text') : null;

    if (!bibtexElement || !button) return;

    function showCopied() {
        button.classList.add('copied');
        if (copyText) copyText.textContent = 'Copied';
        setTimeout(function() {
            button.classList.remove('copied');
            if (copyText) copyText.textContent = 'Copy';
        }, 2000);
    }

    if (navigator.clipboard) {
        navigator.clipboard.writeText(bibtexElement.textContent).then(showCopied).catch(function(err) {
            console.error('Failed to copy: ', err);
        });
    } else {
        const textArea = document.createElement('textarea');
        textArea.value = bibtexElement.textContent;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showCopied();
    }
}

// Scroll to top functionality
function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.addEventListener('scroll', function() {
    const scrollButton = document.querySelector('.scroll-to-top');
    if (!scrollButton) return;
    if (window.pageYOffset > 300) {
        scrollButton.classList.add('visible');
    } else {
        scrollButton.classList.remove('visible');
    }
});

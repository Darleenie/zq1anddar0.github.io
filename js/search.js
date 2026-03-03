// Redirect to the inventory page, passing the search query
function searchItem() {
  const input = document.getElementById('itemInput').value.trim();
  if (!input) {
    alert('Please enter an item name.');
    return;
  }
  window.location.href = 'pages/search.html?q=' + encodeURIComponent(input);
}

// Allow pressing Enter to search
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('itemInput');
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') searchItem();
    });
  }
});

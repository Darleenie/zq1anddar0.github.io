function findItem() {
    const item = document.getElementById('itemInput').value.trim();
    if (item) {
      // Replace with actual logic or URL structure
      window.location.href = `${item.toLowerCase()}.html`;
    } else {
      alert('Please enter an item name.');
    }
  }
  
  function navigateTo(page) {
    window.location.href = page;
  }
  
// Sample data representing your items
const items = [
    {
      name: "Bowls",
      image: "../assets/bowls.jpg",
      location: "Right Kitchen Cabinet, Second Floor"
    },
    {
      name: "Switch",
      image: "../assets/switch.jpg",
      location: "Living Room Desk"
    },
    {
      name: "Shoe Cleaner",
      image: "../assets/shoe_cleaner.jpg",
      location: "Entrance Brown Cabinet"
    }
  ];

// Function to handle the search
function searchItem() {
    const input = document.getElementById('itemInput').value.trim().toLowerCase();
    const resultDiv = document.getElementById('searchResult');
    resultDiv.innerHTML = ''; // Clear previous results
  
    if (input) {
      const item = items.find(i => i.name.toLowerCase() === input);
      if (item) {
        // Display the item's image and location
        resultDiv.innerHTML = `
          <img src="${item.image}" alt="${item.name}" />
          <p><strong>Location:</strong> ${item.location}</p>
          <button onclick="moreInfo('${item.name}')">More Info</button>
        `;
      } else {
        resultDiv.innerHTML = `<p>Item not found.</p>`;
      }
    } else {
      alert('Please enter an item name.');
    }
  }
  
  // Function to handle the "More Info" button click
  function moreInfo(itemName) {
    // Redirect to a detailed page or perform another action
    // For demonstration, we'll redirect to a generic page
    window.location.href = '/pages/search.html?item=' + encodeURIComponent(itemName);
  }
  
  // Add event listener to the search input
//   document.getElementById('searchInput').addEventListener('keyup', function(event) {
//     if (event.key === 'Enter') {
//       searchItem();
//     }
//   });
fetch('../pages/nav.html')
    .then(response => response.text())
    .then(data => {
      document.getElementById('nav-placeholder').innerHTML = data;
    });


const menuToggle = document.getElementById('mobile-menu');
const navMenu = document.querySelector('.nav-menu');
// const navLinks = document.querySelectorAll('.nav-menu li a');

menuToggle.addEventListener('click', () => {
    navMenu.classList.toggle('active');
});

// navLinks.forEach(link => {
//   link.addEventListener('click', () => {
//     navMenu.classList.remove('active');
//   });
// });
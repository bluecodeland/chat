const socket = io('https://chat.id1.ir', {
    secure: true,
    rejectUnauthorized: false
  });
  const loginForm = document.getElementById('loginForm');
  const loginDiv = document.getElementById('login');
  const chatDiv = document.getElementById('chat');
  const messages = document.getElementById('messages');
  const form = document.getElementById('form');
  const input = document.getElementById('input');
  const fileInput = document.getElementById('fileInput');
  
  function login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    fetch('/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        loginDiv.classList.add('hidden');
        chatDiv.classList.remove('hidden');
        socket.nickname = data.nickname; // Store the nickname in the socket object
      } else {
        alert('ورود ناموفق بود');
      }
    });
  }
  
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    const file = fileInput.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function(e) {
        const fileData = e.target.result;
        socket.emit('file upload', { nickname: socket.nickname, file: fileData, fileName: file.name });
      };
      reader.readAsDataURL(file);
    } else if (input.value) {
      socket.emit('chat message', { nickname: socket.nickname, message: input.value });
      input.value = '';
      scrollToBottom(); // Scroll to bottom after sending a message
    }
  });
  
  socket.on('chat message', function(data) {
    const item = document.createElement('li');
    item.classList.add('text-right', 'mb-2', 'chat-message');
    item.innerHTML = `<strong>${data.nickname}:</strong> ${data.message}`;
    messages.appendChild(item);
    scrollToBottom(); // Scroll to bottom after receiving a message
  });
  
  socket.on('file upload', function(data) {
    const item = document.createElement('li');
    item.classList.add('text-right', 'mb-2', 'chat-message');
    item.innerHTML = `<strong>${data.nickname}:</strong> <a href="${data.file}" download="${data.fileName}">${data.fileName}</a>`;
    messages.appendChild(item);
    scrollToBottom(); // Scroll to bottom after receiving a file
  });
  
  socket.on('clear messages', function() {
    while (messages.firstChild) {
      messages.removeChild(messages.firstChild);
    }
    scrollToBottom(); // Scroll to bottom after clearing messages
  });
  
  function clearMessages() {
    socket.emit('clear messages');
  }
  
  function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
  }
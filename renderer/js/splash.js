    const fill = document.getElementById('progressFill');
    const statusEl = document.getElementById('statusText');

    const statusMessages = [
      'Initializing backend environment...',
      'Starting RAG server...',
      'Verifying vector database layers...',
      'Setting up semantic indexes...',
      'Loading AI agent configs...',
      'Ready'
    ];

    function setProgress(pct, msg) {
      fill.style.width = pct + '%';
      if (msg !== undefined) statusEl.innerHTML = msg;
    }

    // Fake loading progress
    let fake = 0;
    let msgIndex = 0;
    
    const interval = setInterval(() => {
      if (fake < 92) {
        let increment = fake > 72 ? Math.random() * 1.5 : Math.random() * 7;
        fake += increment;
        
        // Progressively update status messages based on percentage
        const progressChunk = 92 / (statusMessages.length - 1);
        const currentMsgIdx = Math.min(
          Math.floor(fake / progressChunk),
          statusMessages.length - 2
        );
        
        setProgress(Math.min(fake, 92), statusMessages[currentMsgIdx]);
      }
    }, 150);

    // Called by main process when backend is ready
    window.onBackendReady = () => {
      clearInterval(interval);
      setProgress(100, 'Ready');
    };
  
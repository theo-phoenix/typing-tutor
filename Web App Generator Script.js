/*
  Typing Tutor Application

  This script implements a complete typing tutor that runs entirely in
  the browser without any external dependencies.  The code is
  organised into self‑invoking modules that encapsulate the core
  functionality: measuring typing metrics, adjusting lesson difficulty
  adaptively, providing motivational feedback and orchestrating the
  user interface.  Extensive comments explain the algorithms and
  principles of typing pedagogy used throughout.

  The modules defined below are:
    - TypingMetrics: tracks WPM, accuracy, per‑key error rates and
      reaction times in real time.
    - AdaptiveEngine: manages the lesson curriculum, adjusts
      difficulty toward a target accuracy band (80–90 %), generates
      spaced repetition drills for weak keys and muscle memory
      routines, and detects stagnation.
    - UIFeedback: displays confetti, badges and caustic messages to
      motivate the user based on their performance.
    - Main: wires together the DOM, listens for key events and
      orchestrates transitions between lessons, drills and routines.
*/

/* ------------------------------------------------------------------ */
/* TypingMetrics module

   This module provides methods to initialise a typing session and to
   update measurements with each keystroke.  At its core are the
   calculations for words per minute (WPM), accuracy (percentage of
   correct keystrokes), per‑key error rates and reaction times.  The
   WPM formula used is the industry standard: (characters typed/5)
   divided by elapsed minutes.  Reaction times are measured as the
   interval in milliseconds between successive keystrokes.

   Per‑key statistics are collected in an object keyed by the
   expected character.  For each character we count how many times it
   appears in the lesson (hits) and how many times the user typed an
   incorrect key at that position (errors).  Error rates for keys are
   later used by the adaptive engine to schedule spaced repetition
   drills for the most troublesome keys.
*/
const TypingMetrics = (function () {
  let expectedText = '';
  let startTime = 0;
  let typedCount = 0;
  let correctCount = 0;
  let errorCount = 0;
  let perKeyStats = {};
  let prevTime = null;
  let reactionTimes = [];
  let finished = false;

  /**
   * Initialise a new typing session.
   *
   * @param {string} text The lesson or drill text that the user will type.
   */
  function init(text) {
    expectedText = text;
    startTime = Date.now();
    typedCount = 0;
    correctCount = 0;
    errorCount = 0;
    perKeyStats = {};
    prevTime = null;
    reactionTimes = [];
    finished = false;
  }

  /**
   * Record a single keystroke.  This function is called every time
   * the user presses a key during an active typing session.  It
   * updates the per‑key statistics, calculates current WPM, accuracy
   * and reaction time and returns those values for immediate display.
   *
   * @param {string} typedChar The character the user typed.
   * @param {string} expectedChar The character that was expected at
   *        this position in the lesson.
   * @returns {object} An object with updated metrics: wpm, accuracy
   *          (percentage) and reaction (ms).
   */
  function recordKey(typedChar, expectedChar) {
    if (finished) return { wpm: 0, accuracy: 0, reaction: 0 };
    const now = Date.now();
    // Reaction time is measured as the difference between this
    // keystroke and the previous keystroke.  The first keystroke
    // defines the starting time.
    if (prevTime !== null) {
      reactionTimes.push(now - prevTime);
    }
    prevTime = now;

    // Update global counts
    typedCount++;
    const correct = typedChar === expectedChar;
    // Create per‑key record if needed
    if (!perKeyStats[expectedChar]) {
      perKeyStats[expectedChar] = { hits: 0, errors: 0 };
    }
    perKeyStats[expectedChar].hits++;
    if (correct) {
      correctCount++;
    } else {
      errorCount++;
      perKeyStats[expectedChar].errors++;
    }

    // Compute elapsed time in minutes for the WPM calculation
    const elapsed = (now - startTime) / 60000;
    const totalChars = correctCount + errorCount;
    // Avoid division by zero by substituting a tiny elapsed value
    const wpm = elapsed > 0 ? (totalChars / 5) / elapsed : 0;
    // Accuracy is the fraction of correct keystrokes
    const accuracy = typedCount > 0 ? (correctCount / typedCount) * 100 : 100;
    // Current reaction time is the last measured interval
    const reaction = reactionTimes.length > 0 ? reactionTimes[reactionTimes.length - 1] : 0;

    return {
      wpm: Math.max(0, Math.round(wpm)),
      accuracy: Math.min(100, Math.max(0, Math.round(accuracy))),
      reaction: Math.round(reaction),
    };
  }

  /**
   * Mark the session as finished.  This prevents further updates to
   * the metrics until a new session is started.
   */
  function finish() {
    finished = true;
  }

  /**
   * Retrieve final statistics for the completed session.  This
   * function computes the average reaction time and bundles the
   * per‑key statistics together with WPM and accuracy.
   *
   * @returns {object} Final session statistics.
   */
  function getStats() {
    const now = Date.now();
    const elapsed = (now - startTime) / 60000;
    const totalChars = correctCount + errorCount;
    const wpm = elapsed > 0 ? (totalChars / 5) / elapsed : 0;
    const accuracy = typedCount > 0 ? (correctCount / typedCount) * 100 : 100;
    const avgReaction = reactionTimes.length > 0 ? reactionTimes.reduce((a, b) => a + b) / reactionTimes.length : 0;
    return {
      wpm: Math.max(0, Math.round(wpm)),
      accuracy: Math.min(100, Math.max(0, Math.round(accuracy))),
      reaction: Math.round(avgReaction),
      perKeyStats: perKeyStats,
    };
  }

  return {
    init,
    recordKey,
    finish,
    getStats,
  };
})();

/* ------------------------------------------------------------------ */
/* AdaptiveEngine module

   The adaptive engine guides the user through a progressive curriculum
   and adjusts lesson difficulty to keep accuracy in the 80–90 % band.
   When the user performs exceptionally well (>90 %) it moves forward
   to a longer or more complex passage; when performance drops below
   80 % it offers a simpler passage or repeats the current one.  The
   engine also analyses per‑key error rates and produces short drills
   that target problematic keys.  Spaced repetition is achieved by
   redisplaying drills for high error keys at increasing intervals.

   In addition, the engine monitors recent sessions for stagnation:
   if three consecutive sessions show little improvement in WPM and
   accuracy, it triggers caustic feedback to spur the user on.
*/
const AdaptiveEngine = (function () {
  // Define the full curriculum.  Each lesson belongs to a level and
  // includes its text.  Complexity is loosely estimated by length; a
  // more formal analysis (e.g., lexical density) could be used in a
  // more sophisticated tutor.
  const lessons = [
    // Beginner level (home row, simple sentences)
    { level: 'Beginner', index: 0, text: 'asdf jkl; asdf jkl; asdf jkl;' },
    { level: 'Beginner', index: 1, text: 'The quick brown fox jumps over the lazy dog.' },
    { level: 'Beginner', index: 2, text: 'Home row practice: ask fad glad jalk flak.' },
    { level: 'Beginner', index: 3, text: 'Typing is fun. Keep your fingers on the home row.' },
    { level: 'Beginner', index: 4, text: 'Practice makes perfect. Focus on accuracy.' },
    // Intermediate level
    { level: 'Intermediate', index: 0, text: 'Success comes from practice and patience. Keep typing without looking at your keyboard and soon it becomes second nature.' },
    { level: 'Intermediate', index: 1, text: 'Typing speed and accuracy improve when you relax your hands and maintain a consistent rhythm.' },
    { level: 'Intermediate', index: 2, text: 'Each finger has its own responsibility on the keyboard, so assign every key to the nearest finger.' },
    { level: 'Intermediate', index: 3, text: 'Learning to type well is like playing a musical instrument: you must train your muscle memory.' },
    { level: 'Intermediate', index: 4, text: 'Confidence grows with each correct keystroke. Keep going even when mistakes happen.' },
    // Advanced level
    { level: 'Advanced', index: 0, text: 'Advanced typists can handle complex sentences with punctuation and numbers such as 12345, 67890. They rarely glance at the keyboard.' },
    { level: 'Advanced', index: 1, text: 'Focus on maintaining posture while typing. Sit upright, keep your wrists elevated, and breathe evenly to sustain longer sessions.' },
    { level: 'Advanced', index: 2, text: 'When errors occur, slow down briefly and refocus on accuracy before returning to your usual pace.' },
    { level: 'Advanced', index: 3, text: 'Typing at high speeds requires that you anticipate upcoming words and move your fingers ahead of time.' },
    { level: 'Advanced', index: 4, text: 'Break down long words into syllables to distribute the typing load evenly across your fingers.' },
    // Master level
    { level: 'Master', index: 0, text: 'Master typists can write code, compose essays, and chat rapidly without any conscious thought of where each key lies.' },
    { level: 'Master', index: 1, text: 'Precision is key: hitting the correct key every time is more valuable than raw speed; accuracy leads to efficiency.' },
    { level: 'Master', index: 2, text: 'Typing mindfully reduces mistakes. Cultivate awareness of each finger\'s movement until typing becomes meditative.' },
    { level: 'Master', index: 3, text: 'Incorporate numbers (1234567890) and symbols (!@#$%^&*) into your practice to become truly versatile.' },
    { level: 'Master', index: 4, text: 'Continue challenging yourself with unfamiliar passages, such as legal documents or poetry, to refine your skills.' },
  ];

  const levelOrder = ['Beginner', 'Intermediate', 'Advanced', 'Master'];

  // Load user progress from localStorage or initialise defaults.  The
  // progress object tracks the current lesson, earned badges, recent
  // session history and accumulated per‑key error rates across
  // sessions.
  const progress = loadProgress();

  /**
   * Group lessons by level for rendering the lesson list.  Returns
   * an object mapping each level name to an array of lessons.
   */
  function getLessonList() {
    const grouped = {};
    lessons.forEach(lesson => {
      if (!grouped[lesson.level]) grouped[lesson.level] = [];
      grouped[lesson.level].push(lesson);
    });
    return grouped;
  }

  /**
   * Retrieve the lesson object corresponding to the currently
   * selected level and index from progress.
   */
  function getCurrentLesson() {
    return lessons.find(
      l => l.level === progress.currentLevel && l.index === progress.currentIndex
    );
  }

  /**
   * Update the current lesson pointers.  Called when a user clicks
   * explicitly on a lesson in the sidebar.
   *
   * @param {string} level The level name.
   * @param {number} index The lesson index within the level.
   */
  function setLesson(level, index) {
    progress.currentLevel = level;
    progress.currentIndex = index;
    saveProgress();
  }

  /**
   * Determine the next lesson based on achieved accuracy.  The goal
   * is to keep the user between 80 and 90 % accuracy.  If accuracy
   * exceeds 90 % and there are more lessons ahead, the engine
   * advances to the next lesson (or next level when the current
   * level is completed).  If accuracy drops below 80 % and there are
   * easier lessons available, it moves backwards.  Otherwise it
   * repeats the current lesson.
   *
   * @param {number} accuracy The accuracy percentage achieved in the
   *        completed session.
   */
  function chooseNextLesson(accuracy) {
    const levelIdx = levelOrder.indexOf(progress.currentLevel);
    let nextLevel = progress.currentLevel;
    let nextIndex = progress.currentIndex;
    if (accuracy > 90) {
      // Try advancing within the level or to the next level
      const lessonsInLevel = lessons.filter(l => l.level === progress.currentLevel);
      if (progress.currentIndex < lessonsInLevel.length - 1) {
        nextIndex++;
      } else if (levelIdx < levelOrder.length - 1) {
        nextLevel = levelOrder[levelIdx + 1];
        nextIndex = 0;
      }
    } else if (accuracy < 80) {
      // Try retreating within the level or to the previous level
      if (progress.currentIndex > 0) {
        nextIndex--;
      } else if (levelIdx > 0) {
        nextLevel = levelOrder[levelIdx - 1];
        // pick last lesson of previous level
        const lessonsPrev = lessons.filter(l => l.level === nextLevel);
        nextIndex = lessonsPrev.length - 1;
      }
    }
    progress.currentLevel = nextLevel;
    progress.currentIndex = nextIndex;
    saveProgress();
  }

  /**
   * Update the global per‑key error rates stored in progress.  This
   * function adds the errors from the current session to a running
   * total so that spaced repetition can be scheduled across multiple
   * lessons.  Only keys with non‑zero hits are updated.
   *
   * @param {object} perKeyStats The per‑key statistics from the
   *        completed session.
   */
  function accumulateKeyStats(perKeyStats) {
    for (const key in perKeyStats) {
      if (!progress.errorRates[key]) {
        progress.errorRates[key] = { hits: 0, errors: 0 };
      }
      progress.errorRates[key].hits += perKeyStats[key].hits;
      progress.errorRates[key].errors += perKeyStats[key].errors;
    }
    saveProgress();
  }

  /**
   * Record the result of a session into the history buffer.  The
   * history contains up to the last five sessions; older entries are
   * removed.  WPM and accuracy are stored for stagnation analysis.
   *
   * @param {object} stats The session statistics (wpm, accuracy).
   */
  function updateHistory(stats) {
    progress.history.push({ wpm: stats.wpm, accuracy: stats.accuracy });
    if (progress.history.length > 5) {
      progress.history.shift();
    }
    saveProgress();
  }

  /**
   * Determine whether the user is stagnating.  If the last three
   * sessions show less than a two percent improvement in accuracy
   * and less than two WPM improvement, the function returns true
   * indicating that caustic feedback should be displayed.  On a
   * positive improvement the stagnation counter resets.
   *
   * @returns {boolean} True if the user is stagnating.
   */
  function isStagnant() {
    const h = progress.history;
    if (h.length < 3) return false;
    // Compute differences between successive sessions
    const deltas = [];
    for (let i = 1; i < h.length; i++) {
      deltas.push({
        wpm: h[i].wpm - h[i - 1].wpm,
        acc: h[i].accuracy - h[i - 1].accuracy,
      });
    }
    // Count sessions where improvement is minimal
    const stagnant = deltas.slice(-3).every(d => Math.abs(d.wpm) < 2 && Math.abs(d.acc) < 2);
    return stagnant;
  }

  /**
   * Extract the keys with the highest error rates.  We compute
   * errorRate = errors / hits for each key and then return those
   * exceeding a threshold.  Only keys with at least a few hits are
   * considered to avoid noise from very rare characters.
   *
   * @param {number} threshold Minimum error rate above which a key
   *        should be drilled (e.g., 0.15 = 15 % errors).
   * @returns {Array<string>} An array of characters that need drills.
   */
  function getHighErrorKeys(threshold = 0.15) {
    const result = [];
    for (const key in progress.errorRates) {
      const data = progress.errorRates[key];
      if (data.hits >= 5) {
        const rate = data.errors / data.hits;
        if (rate >= threshold) {
          result.push(key);
        }
      }
    }
    return result;
  }

  /**
   * Generate a short drill string focusing on the given set of keys.
   * To reinforce muscle memory, the keys are repeated in clusters
   * separated by spaces.  The sequence length is intentionally
   * modest (around 40 characters) so that the user can complete it
   * quickly.  For example, if keys = ['a','s'] the drill might be
   * 'aaaa ssaa ssaa aass'.
   *
   * @param {Array<string>} keys The characters that need practice.
   * @returns {string} A generated drill string.
   */
  function generateDrill(keys) {
    if (!keys || keys.length === 0) return '';
    const parts = [];
    // Build clusters of 4 characters, mixing keys randomly
    for (let i = 0; i < 10; i++) {
      let cluster = '';
      for (let j = 0; j < 4; j++) {
        const k = keys[Math.floor(Math.random() * keys.length)];
        cluster += k;
      }
      parts.push(cluster);
    }
    return parts.join(' ');
  }

  /**
   * Provide a prebuilt muscle‑memory routine focusing on the home row
   * and other common patterns.  These sequences help strengthen the
   * automatic finger movements required for touch typing.  Users may
   * encounter this routine periodically as they progress.
   *
   * @returns {string} A muscle memory practice string.
   */
  function getMuscleMemoryRoutine() {
    return 'asdf jkl; fdsa ;lkj asdfg hjkl; gfdsa ;lkjh';
  }

  /**
   * Helper to load persisted progress from localStorage.  On first
   * load, sensible defaults are returned.  Note: localStorage is a
   * simple key‑value store available in modern browsers and does not
   * require any server infrastructure.
   */
  function loadProgress() {
    try {
      const raw = localStorage.getItem('typingProgress');
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('Could not load progress:', e);
    }
    return {
      currentLevel: 'Beginner',
      currentIndex: 0,
      badges: { wpm50: false, acc90: false },
      history: [],
      errorRates: {},
    };
  }

  /**
   * Persist the progress state into localStorage.  Called whenever
   * progress is updated.
   */
  function saveProgress() {
    try {
      localStorage.setItem('typingProgress', JSON.stringify(progress));
    } catch (e) {
      console.warn('Could not save progress:', e);
    }
  }

  return {
    getLessonList,
    getCurrentLesson,
    setLesson,
    chooseNextLesson,
    updateHistory,
    isStagnant,
    accumulateKeyStats,
    getHighErrorKeys,
    generateDrill,
    getMuscleMemoryRoutine,
    progress,
    saveProgress,
    levelOrder,
  };
})();

/* ------------------------------------------------------------------ */
/* UIFeedback module

   The UIFeedback module handles all user motivational cues including
   achievement badges, confetti animations and caustic remarks in a
   playful mix of Nigerian Pidgin and English.  Badges are awarded
   when the user surpasses predefined milestones (e.g., 50 WPM or
   90 % accuracy) and each badge is shown only once.  Confetti
   provides a burst of visual gratification when the user completes a
   lesson or earns a badge.  Caustic messages are displayed after
   multiple stagnant sessions to gently admonish the user.
*/
const UIFeedback = (function () {
  const badgeModal = document.getElementById('badgeModal');
  const badgeTextEl = document.getElementById('badgeText');
  const badgeClose = document.getElementById('badgeClose');
  const messageBar = document.getElementById('messageBar');

  /**
   * Display the badge modal with the specified message.  The modal
   * blocks interaction with the page until the user closes it.  A
   * confetti effect accompanies the award.
   *
   * @param {string} text The text to display inside the modal.
   */
  function showBadge(text) {
    badgeTextEl.textContent = text;
    badgeModal.classList.remove('hidden');
    // Launch confetti concurrently with the badge
    showConfetti(80);
  }

  // Hide badge when the close button is clicked
  badgeClose.addEventListener('click', () => {
    badgeModal.classList.add('hidden');
  });

  /**
   * Generate a confetti effect by injecting a number of tiny
   * coloured elements that fall from the top of the viewport.  Each
   * confetti piece is assigned random horizontal position and delay
   * offset to create a natural spread.  Confetti pieces remove
   * themselves from the DOM after the animation completes.
   *
   * @param {number} count The number of confetti pieces to create.
   */
  function showConfetti(count = 50) {
    const colours = ['#556B2F', '#6B8E23', '#8FBC8F', '#A3C586'];
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.backgroundColor = colours[Math.floor(Math.random() * colours.length)];
      // Vary animation duration slightly for variety
      const duration = 2 + Math.random() * 1.5;
      piece.style.animationDuration = duration + 's';
      // Delay some pieces to stagger the fall
      const delay = Math.random() * 0.3;
      piece.style.animationDelay = delay + 's';
      document.body.appendChild(piece);
      // Remove after animation
      setTimeout(() => {
        piece.remove();
      }, (duration + delay) * 1000);
    }
  }

  /**
   * Display a temporary caustic message.  The message bar slides up
   * from the bottom of the viewport, stays visible for a few
   * seconds and then disappears automatically.
   *
   * @param {string} text The message to display.
   */
  function showMessage(text) {
    messageBar.textContent = text;
    messageBar.classList.remove('hidden');
    setTimeout(() => {
      messageBar.classList.add('hidden');
    }, 5000);
  }

  return {
    showBadge,
    showConfetti,
    showMessage,
  };
})();

/* ------------------------------------------------------------------ */
/* Main application logic

   The main module ties together the DOM, typing metrics, adaptive
   engine and user feedback.  It initialises the lesson list,
   responds to user input, updates the display in real time and
   triggers the appropriate feedback after each session.  The use of
   closures and modular organisation keeps the global namespace
   uncluttered and makes the code easier to follow.
*/
(function () {
  const lessonListEl = document.getElementById('lessonList');
  const displayAreaEl = document.getElementById('displayText');
  const lessonHeaderEl = document.getElementById('lessonHeader');
  const wpmEl = document.getElementById('wpm');
  const accEl = document.getElementById('accuracy');
  const reactionEl = document.getElementById('reaction');
  const lessonCompleteEl = document.getElementById('lessonComplete');
  const nextLessonBtn = document.getElementById('nextLessonBtn');
  const hiddenInput = document.getElementById('hiddenInput');

  // Predefined list of caustic remarks mixing Nigerian Pidgin with
  // English.  These remarks are rotated when stagnation is detected.
  const causticMessages = [
    'Omo, you dey slow like snail—try small jare!',
    'Accuracy don fall o—no dull yourself abeg!',
    'No b slack, make those keystrokes sharp sharp!',
  ];
  let causticIndex = 0;

  // Keep track of current session state
  let currentText = '';
  let currentPos = 0;
  let inDrill = false;

  /**
   * Render the hierarchical lesson list.  Lessons are grouped by
   * level and each list item receives a click handler that
   * immediately loads the chosen lesson.
   */
  function renderLessonList() {
    const grouped = AdaptiveEngine.getLessonList();
    lessonListEl.innerHTML = '<h2 class="list-title">Lessons</h2>';
    AdaptiveEngine.levelOrder.forEach(level => {
      const groupEl = document.createElement('div');
      groupEl.className = 'level-group';
      const titleEl = document.createElement('div');
      titleEl.className = 'level-title';
      titleEl.textContent = level;
      groupEl.appendChild(titleEl);
      const listEl = document.createElement('ul');
      listEl.className = 'lesson-items';
      const levelLessons = grouped[level];
      levelLessons.forEach(lesson => {
        const li = document.createElement('li');
        li.className = 'lesson-item';
        li.textContent = 'Lesson ' + (lesson.index + 1);
        li.dataset.level = lesson.level;
        li.dataset.index = lesson.index;
        if (lesson.level === AdaptiveEngine.progress.currentLevel && lesson.index === AdaptiveEngine.progress.currentIndex) {
          li.classList.add('selected');
        }
        li.addEventListener('click', () => {
          AdaptiveEngine.setLesson(lesson.level, lesson.index);
          loadLesson();
          // Update highlight
          document.querySelectorAll('.lesson-item').forEach(item => item.classList.remove('selected'));
          li.classList.add('selected');
        });
        listEl.appendChild(li);
      });
      groupEl.appendChild(listEl);
      lessonListEl.appendChild(groupEl);
    });
  }

  /**
   * Prepare the typing panel for a new lesson or drill.  The text is
   * split into individual span elements for fine‑grained control of
   * styling (correct, incorrect and current characters).  The
   * TypingMetrics module is initialised with the new text and
   * counters are reset.  The hidden input is focused so that
   * mobile virtual keyboards appear when the panel is tapped.
   *
   * @param {string} [overrideText] Optional text to use instead of
   *        the current lesson (used for drills and routines).
   */
  function loadLesson(overrideText) {
    const lesson = AdaptiveEngine.getCurrentLesson();
    currentText = overrideText || lesson.text;
    currentPos = 0;
    inDrill = !!overrideText;
    // Set header to indicate whether we're in a drill or regular lesson
    if (inDrill) {
      lessonHeaderEl.textContent = 'Drill Session';
    } else {
      lessonHeaderEl.textContent = `${lesson.level} — Lesson ${lesson.index + 1}`;
    }
    TypingMetrics.init(currentText);
    // Build spans for each character
    displayAreaEl.innerHTML = '';
    for (let i = 0; i < currentText.length; i++) {
      const span = document.createElement('span');
      span.className = 'char';
      span.textContent = currentText[i];
      if (i === 0) span.classList.add('current');
      displayAreaEl.appendChild(span);
    }
    wpmEl.textContent = '0';
    accEl.textContent = '100';
    reactionEl.textContent = '0';
    lessonCompleteEl.classList.add('hidden');
    // Focus hidden input to support mobile typing
    hiddenInput.focus();
  }

  /**
   * Advance the cursor and update the styling of characters.  Each
   * character is marked as correct or incorrect based on the typed
   * input, and the next character is given the 'current' class.
   *
   * @param {boolean} correct Whether the typed character matched the
   *        expected character.
   */
  function updateDisplay(correct) {
    const spans = displayAreaEl.querySelectorAll('.char');
    if (currentPos < spans.length) {
      const span = spans[currentPos];
      span.classList.remove('current');
      span.classList.add(correct ? 'correct' : 'incorrect');
    }
    currentPos++;
    if (currentPos < spans.length) {
      spans[currentPos].classList.add('current');
    }
  }

  /**
   * Handle the completion of a session.  This function collects the
   * final statistics, updates history, accumulates error rates, awards
   * badges, shows confetti and decides what should happen next.
   */
  function finishSession() {
    TypingMetrics.finish();
    const stats = TypingMetrics.getStats();
    AdaptiveEngine.updateHistory(stats);
    AdaptiveEngine.accumulateKeyStats(stats.perKeyStats);
    // Update metric displays with final averages
    wpmEl.textContent = stats.wpm;
    accEl.textContent = stats.accuracy;
    reactionEl.textContent = stats.reaction;
    // Award badges if thresholds are reached and not already earned
    if (!AdaptiveEngine.progress.badges.wpm50 && stats.wpm >= 50) {
      AdaptiveEngine.progress.badges.wpm50 = true;
      UIFeedback.showBadge('🏅 50 WPM Club!');
    }
    if (!AdaptiveEngine.progress.badges.acc90 && stats.accuracy >= 90) {
      AdaptiveEngine.progress.badges.acc90 = true;
      UIFeedback.showBadge('🎯 90% Accuracy Achieved!');
    }
    AdaptiveEngine.saveProgress();
    // Detect stagnation and deliver a caustic remark if necessary
    if (AdaptiveEngine.isStagnant()) {
      const msg = causticMessages[causticIndex % causticMessages.length];
      causticIndex++;
      UIFeedback.showMessage(msg);
    }
    // Determine if a drill is needed based on error rates
    const highKeys = AdaptiveEngine.getHighErrorKeys();
    if (highKeys.length > 0 && !inDrill) {
      // Generate a drill focusing on problematic keys
      const drillText = AdaptiveEngine.generateDrill(highKeys);
      // Slight delay before starting drill to give user a moment
      setTimeout(() => {
        loadLesson(drillText);
      }, 1000);
      return;
    }
    // If we completed a drill, go back to the regular lesson progression
    if (inDrill) {
      // After drill, do not evaluate accuracy for difficulty adjustment
      inDrill = false;
      // Reload the same lesson we were on before the drill
      loadLesson();
      return;
    }
    // Choose next lesson based on accuracy and update highlight
    AdaptiveEngine.chooseNextLesson(stats.accuracy);
    // Show complete message and next button.  The button handler
    // will load the next lesson.
    lessonCompleteEl.classList.remove('hidden');
  }

  /**
   * Handle keystrokes during an active session.  Non‑character keys
   * such as Shift, Alt and control characters are ignored.  After
   * recording the keystroke, the display and metrics are updated.
   * If the end of the text is reached, the session is finished.
   *
   * @param {KeyboardEvent} event The DOM keyboard event.
   */
  function handleKey(event) {
    // Ignore keys that do not produce a character
    if (event.key.length !== 1) return;
    if (currentPos >= currentText.length) return;
    const expectedChar = currentText[currentPos];
    const typedChar = event.key;
    // Record the key and compute metrics
    const metrics = TypingMetrics.recordKey(typedChar, expectedChar);
    wpmEl.textContent = metrics.wpm;
    accEl.textContent = metrics.accuracy;
    reactionEl.textContent = metrics.reaction;
    // Update display with feedback for this character
    updateDisplay(typedChar === expectedChar);
    // If we've reached the end, finish the session
    if (currentPos >= currentText.length) {
      finishSession();
    }
  }

  /**
   * Initialise event listeners and load the initial lesson when the
   * document is ready.
   */
  function init() {
    renderLessonList();
    loadLesson();
    // Keydown listener captures keystrokes anywhere on the page
    document.addEventListener('keydown', handleKey);
    // Ensure the hidden input regains focus when the panel is clicked
    document.addEventListener('click', () => {
      hiddenInput.focus();
    });
    // Next lesson button handler
    nextLessonBtn.addEventListener('click', () => {
      lessonCompleteEl.classList.add('hidden');
      // Load the next lesson after awarding confetti
      loadLesson();
      // Update highlight on lesson list to reflect new selection
      document.querySelectorAll('.lesson-item').forEach(item => {
        const lvl = item.dataset.level;
        const idx = parseInt(item.dataset.index);
        if (lvl === AdaptiveEngine.progress.currentLevel && idx === AdaptiveEngine.progress.currentIndex) {
          item.classList.add('selected');
        } else {
          item.classList.remove('selected');
        }
      });
    });
  }

  // Kick off the application once DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
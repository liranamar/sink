(function () {
  const DAYS = window.SINK_DAYS;
  const START = 7 * 60;
  const END = 22 * 60;
  // Ends of the drawn line, in timeline coordinates.
  const TRACK_LEFT = 69;
  const TRACK_RIGHT = 1711;
  const KEY_STEP = 5;
  const FADE_MS = 500; // Matches the default transition in style.css.
  const PLAY_MS = 10000;
  const PLAY_FADE_MAX = 260;
  const MAX_FRAME_MS = 100;
  const LABEL_MAX_WIDTH = 336;
  const LABEL_SPACES = 4;

  const el = (id) => document.getElementById(id);
  const stage = el("stage");
  const timeline = el("timeline");
  const handle = el("handle");
  const viewer = el("viewer");
  const photoStack = el("photoStack");
  const photoGrid = el("photoGrid");
  const timeTag = el("timeTag");
  const dayLabel = el("dayLabel");
  const prevDay = el("prevDay");
  const nextDay = el("nextDay");
  const calendar = el("calendar");
  const calendarButton = el("calendarButton");
  const viewButton = el("viewButton");
  const playButton = el("playButton");
  const speedOptions = el("speedOptions");

  const toMinutes = (time) => {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  };
  const toTime = (minutes) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const toX = (minutes) =>
    TRACK_LEFT + ((minutes - START) / (END - START)) * (TRACK_RIGHT - TRACK_LEFT);

  DAYS.forEach((day) => day.photos.forEach((p) => {
    p.minutes = toMinutes(p.time);
    p.day = day;
    new Image().src = p.src;
  }));

  let dayIndex = 0;
  let minutes = DAYS[0].photos[0].minutes;
  let scale = 1;
  let shownSrc = null;
  let fadeToken = 0;
  let fadeMs = FADE_MS;
  let isGrid = false;
  let isPlaying = false;
  let playFrame = 0;
  let pausedProgress = null;
  let playSpeed = 1;

  // The sink stays as last photographed: show the latest photo taken up to this
  // moment, carrying over from the previous day before the day's first photo.
  function photoAt(index, time) {
    const today = DAYS[index].photos.filter((p) => p.minutes <= time).pop();
    if (today) return today;
    for (let i = index - 1; i >= 0; i -= 1) {
      const last = DAYS[i].photos[DAYS[i].photos.length - 1];
      if (last) return last;
    }
    return null;
  }

  function render() {
    const day = DAYS[dayIndex];
    const current = photoAt(dayIndex, minutes);
    const shownTime = toTime(minutes);

    handle.style.left = `${toX(minutes)}px`;
    handle.setAttribute("aria-valuenow", minutes);
    handle.setAttribute("aria-valuetext", current ? `${shownTime}, photo from ${current.day.name} ${current.time}` : `${shownTime}, no photo yet`);
    timeTag.textContent = shownTime;
    setDayLabel(`${day.name}  |  ${day.date}`);
    prevDay.disabled = dayIndex === 0;
    nextDay.disabled = dayIndex === DAYS.length - 1;

    showPhoto(
      current ? current.src : null,
      current ? `The sink on ${current.day.name} ${current.day.date} at ${current.time}` : ""
    );
    markCurrentThumb(current);
    markCurrentDate();
  }

  // Longer day names tighten the spaces so the date never touches the arrows.
  function setDayLabel(text) {
    if (dayLabel.textContent === text) return;
    const line = document.createElement("span");
    line.textContent = text;
    dayLabel.replaceChildren(line);
    const extra = line.offsetWidth - LABEL_MAX_WIDTH;
    if (extra > 0) line.style.wordSpacing = `${-extra / LABEL_SPACES}px`;
  }

  // Each new photo fades in on top of the one before it, which is removed once
  // covered. While dragging fast, photos that were passed over are skipped.
  function showPhoto(src, alt) {
    if (src === shownSrc) return;
    shownSrc = src;
    const token = ++fadeToken;
    const duration = fadeMs;

    if (!src) {
      [...photoStack.children].forEach((img) => img.classList.remove("is-visible"));
      setTimeout(() => {
        if (token === fadeToken) photoStack.replaceChildren();
      }, duration);
      return;
    }

    const next = new Image();
    next.className = "viewer__photo";
    next.alt = alt;
    next.src = src;
    next.decode().catch(() => {}).then(() => {
      if (token !== fadeToken) return;
      const older = [...photoStack.children];
      older.forEach((img) => { img.alt = ""; });
      photoStack.appendChild(next);
      next.getBoundingClientRect();
      next.classList.add("is-visible");
      setTimeout(() => older.forEach((img) => img.remove()), duration);
    });
  }

  function setMinutes(value) {
    minutes = Math.max(START, Math.min(END, Math.round(value)));
    render();
  }

  function setDay(index) {
    stopPlaying();
    dayIndex = Math.max(0, Math.min(DAYS.length - 1, index));
    if (isGrid) buildGrid();
    render();
  }

  /* Grid view */

  function buildGrid() {
    const { photos } = DAYS[dayIndex];
    photoGrid.style.setProperty("--cols", Math.ceil(Math.sqrt(photos.length)));
    photoGrid.replaceChildren(...photos.map((p) => {
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "thumb";
      thumb.dataset.src = p.src;
      thumb.setAttribute("aria-label", `Open the photo from ${p.time}`);

      const image = new Image();
      image.src = p.src;
      image.alt = "";
      image.decoding = "async";

      const time = document.createElement("span");
      time.textContent = p.time;

      thumb.append(image, time);
      thumb.addEventListener("click", () => {
        setMinutes(p.minutes);
        setGrid(false);
      });
      return thumb;
    }));
  }

  function markCurrentThumb(current) {
    photoGrid.querySelectorAll(".thumb").forEach((thumb) => {
      thumb.classList.toggle("is-current", Boolean(current) && thumb.dataset.src === current.src);
    });
  }

  function setGrid(value) {
    isGrid = value;
    if (isGrid) {
      stopPlaying();
      buildGrid();
    }
    photoGrid.hidden = !isGrid;
    photoStack.hidden = isGrid;
    viewButton.classList.toggle("is-grid", isGrid);
    viewButton.setAttribute("aria-pressed", String(isGrid));
    viewButton.setAttribute("aria-label", isGrid ? "Back to full-size photo" : "Show all photos of this day");
    render();
  }

  /* Playback: every photo of the day gets an equal share of the clip. */

  function playStops() {
    const stops = DAYS[dayIndex].photos.map((p) => p.minutes);
    if (stops[stops.length - 1] < END) stops.push(END);
    return stops;
  }

  function minutesAtProgress(stops, progress) {
    const segments = stops.length - 1;
    const position = Math.min(progress, 1) * segments;
    const index = Math.min(Math.floor(position), segments - 1);
    return stops[index] + (stops[index + 1] - stops[index]) * (position - index);
  }

  function updatePlayButton() {
    playButton.classList.toggle("is-playing", isPlaying);
    playButton.setAttribute("aria-label", isPlaying ? "Pause" : "Play this day");
    speedOptions.hidden = !isPlaying && pausedProgress === null;
  }

  function applyPlayFade() {
    const photoMs = PLAY_MS / playSpeed / (playStops().length - 1);
    fadeMs = Math.min(PLAY_FADE_MAX, Math.round(photoMs * 0.6));
    viewer.style.setProperty("--fade", `${fadeMs}ms`);
  }

  function setSpeed(speed) {
    playSpeed = speed;
    speedOptions.querySelectorAll("[data-speed]").forEach((option) => {
      option.setAttribute("aria-pressed", String(Number(option.dataset.speed) === speed));
    });
    if (isPlaying) applyPlayFade();
  }

  function startPlaying() {
    if (isGrid) setGrid(false);
    closeCalendar();

    const stops = playStops();
    let progress = pausedProgress === null ? 0 : pausedProgress;
    let lastFrame = performance.now();
    pausedProgress = null;
    isPlaying = true;
    applyPlayFade();
    updatePlayButton();

    const tick = (now) => {
      if (!isPlaying) return;
      // Capped so the clip doesn't jump ahead after the tab was in the background.
      const elapsed = Math.min(Math.max(now - lastFrame, 0), MAX_FRAME_MS);
      lastFrame = now;
      progress += elapsed / (PLAY_MS / playSpeed);
      if (progress >= 1) {
        setMinutes(stops[stops.length - 1]);
        stopPlaying();
        return;
      }
      pausedProgress = progress;
      setMinutes(minutesAtProgress(stops, progress));
      playFrame = requestAnimationFrame(tick);
    };
    playFrame = requestAnimationFrame(tick);
  }

  function stopPlaying(keepPosition = false) {
    if (isPlaying) {
      isPlaying = false;
      cancelAnimationFrame(playFrame);
      fadeMs = FADE_MS;
      viewer.style.removeProperty("--fade");
    }
    if (!keepPosition) pausedProgress = null;
    updatePlayButton();
  }

  speedOptions.addEventListener("click", (event) => {
    const option = event.target.closest("[data-speed]");
    if (option) setSpeed(Number(option.dataset.speed));
  });

  playButton.addEventListener("click", () => {
    if (isPlaying) stopPlaying(true);
    else startPlaying();
  });

  viewButton.addEventListener("click", () => setGrid(!isGrid));

  /* Calendar */

  function buildCalendar() {
    const [, month, year] = DAYS[0].date.split(".").map(Number);
    const monthName = new Date(year, month - 1, 1)
      .toLocaleString("en", { month: "long" })
      .toLowerCase();
    const leadingBlanks = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();

    const title = document.createElement("p");
    title.className = "calendar__title";
    title.textContent = `${monthName} ${year}`;

    const grid = document.createElement("div");
    grid.className = "calendar__grid";
    ["S", "M", "T", "W", "T", "F", "S"].forEach((letter) => {
      const weekday = document.createElement("span");
      weekday.className = "calendar__weekday";
      weekday.textContent = letter;
      weekday.setAttribute("aria-hidden", "true");
      grid.appendChild(weekday);
    });
    for (let i = 0; i < leadingBlanks; i += 1) grid.appendChild(document.createElement("span"));

    for (let date = 1; date <= daysInMonth; date += 1) {
      const key = `${String(date).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
      const index = DAYS.findIndex((day) => day.date === key);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "calendar__day";
      button.textContent = date;
      button.disabled = index === -1;
      button.setAttribute("aria-label", index === -1 ? `${key}, no photos` : `${DAYS[index].name} ${key}`);
      if (index !== -1) {
        button.dataset.dayIndex = index;
        button.addEventListener("click", () => {
          setDay(index);
          closeCalendar();
          calendarButton.focus();
        });
      }
      grid.appendChild(button);
    }
    calendar.replaceChildren(title, grid);
  }

  function markCurrentDate() {
    calendar.querySelectorAll("[data-day-index]").forEach((button) => {
      if (Number(button.dataset.dayIndex) === dayIndex) button.setAttribute("aria-current", "date");
      else button.removeAttribute("aria-current");
    });
  }

  function openCalendar() {
    calendar.hidden = false;
    calendarButton.setAttribute("aria-expanded", "true");
    const selected = calendar.querySelector('[aria-current="date"]');
    if (selected) selected.focus();
  }

  function closeCalendar() {
    calendar.hidden = true;
    calendarButton.setAttribute("aria-expanded", "false");
  }

  calendarButton.addEventListener("click", () => {
    if (calendar.hidden) openCalendar();
    else closeCalendar();
  });

  document.addEventListener("pointerdown", (event) => {
    if (calendar.hidden) return;
    if (!calendar.contains(event.target) && !calendarButton.contains(event.target)) closeCalendar();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !calendar.hidden) {
      closeCalendar();
      calendarButton.focus();
    }
  });

  /* Timeline */

  function moveToPointer(event) {
    const x = (event.clientX - timeline.getBoundingClientRect().left) / scale;
    const ratio = (x - TRACK_LEFT) / (TRACK_RIGHT - TRACK_LEFT);
    setMinutes(START + ratio * (END - START));
  }

  timeline.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    stopPlaying();
    timeline.setPointerCapture(event.pointerId);
    timeline.classList.add("is-dragging");
    handle.focus({ preventScroll: true });
    moveToPointer(event);
  });
  timeline.addEventListener("pointermove", (event) => {
    if (timeline.hasPointerCapture(event.pointerId)) moveToPointer(event);
  });
  const stopDragging = () => timeline.classList.remove("is-dragging");
  timeline.addEventListener("pointerup", stopDragging);
  timeline.addEventListener("pointercancel", stopDragging);

  handle.addEventListener("keydown", (event) => {
    const moves = {
      ArrowRight: minutes + KEY_STEP,
      ArrowUp: minutes + KEY_STEP,
      ArrowLeft: minutes - KEY_STEP,
      ArrowDown: minutes - KEY_STEP,
      PageUp: minutes + 60,
      PageDown: minutes - 60,
      Home: START,
      End: END,
    };
    if (event.key in moves) {
      event.preventDefault();
      stopPlaying();
      setMinutes(moves[event.key]);
    }
  });

  // The handle's focus ring is for keyboard users only.
  document.addEventListener("keydown", () => document.body.classList.add("using-keyboard"));
  document.addEventListener("pointerdown", () => document.body.classList.remove("using-keyboard"));

  prevDay.addEventListener("click", () => setDay(dayIndex - 1));
  nextDay.addEventListener("click", () => setDay(dayIndex + 1));

  // Goes to the newest photo, so it keeps working after the last documented day.
  el("todayButton").addEventListener("click", () => {
    closeCalendar();
    const lastIndex = DAYS.length - 1;
    const { photos } = DAYS[lastIndex];
    minutes = photos[photos.length - 1].minutes;
    setDay(lastIndex);
  });

  const hours = el("hours");
  for (let hour = 7; hour <= 22; hour += 1) {
    const label = document.createElement("span");
    label.textContent = hour;
    label.style.left = `${toX(hour * 60)}px`;
    hours.appendChild(label);
  }

  function fit() {
    scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    const x = (window.innerWidth - 1920 * scale) / 2;
    const y = (window.innerHeight - 1080 * scale) / 2;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }

  window.addEventListener("resize", fit);
  buildCalendar();
  fit();
  render();
})();

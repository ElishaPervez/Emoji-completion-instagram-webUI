/* global chrome, document */
"use strict";

const DEFAULT_SETTINGS = {
  mode: "discord",
  triggerMinChars: 1,
  maxSuggestions: 8,
  commitWithTab: true,
  commitWithEnter: true,
  convertOnCloseColon: true,
  insertTrailingSpace: false,
  enableEmoticonConversion: false
};

const MODE_PRESETS = {
  discord: {
    commitWithTab: true,
    commitWithEnter: true,
    convertOnCloseColon: true
  },
  slack: {
    commitWithTab: false,
    commitWithEnter: true,
    convertOnCloseColon: true
  }
};

const ids = [
  "mode",
  "triggerMinChars",
  "maxSuggestions",
  "commitWithTab",
  "commitWithEnter",
  "convertOnCloseColon",
  "insertTrailingSpace",
  "enableEmoticonConversion"
];

document.addEventListener("DOMContentLoaded", init);

function init() {
  const form = document.getElementById("settingsForm");
  const applyPresetButton = document.getElementById("applyPreset");

  loadSettings();
  form.addEventListener("submit", onSave);
  applyPresetButton.addEventListener("click", onApplyPreset);
}

function loadSettings() {
  if (!chrome || !chrome.storage || !chrome.storage.sync) {
    setStatus("Chrome storage API not available.");
    applyToForm(DEFAULT_SETTINGS);
    return;
  }

  chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
    applyToForm({ ...DEFAULT_SETTINGS, ...stored });
  });
}

function applyToForm(settings) {
  document.getElementById("mode").value = settings.mode;
  document.getElementById("triggerMinChars").value = String(settings.triggerMinChars);
  document.getElementById("maxSuggestions").value = String(settings.maxSuggestions);
  document.getElementById("commitWithTab").checked = Boolean(settings.commitWithTab);
  document.getElementById("commitWithEnter").checked = Boolean(settings.commitWithEnter);
  document.getElementById("convertOnCloseColon").checked = Boolean(settings.convertOnCloseColon);
  document.getElementById("insertTrailingSpace").checked = Boolean(settings.insertTrailingSpace);
  document.getElementById("enableEmoticonConversion").checked = Boolean(settings.enableEmoticonConversion);
}

function onSave(event) {
  event.preventDefault();
  const next = readFromForm();
  chrome.storage.sync.set(next, () => {
    setStatus("Saved.");
  });
}

function onApplyPreset() {
  const mode = document.getElementById("mode").value === "slack" ? "slack" : "discord";
  const preset = MODE_PRESETS[mode];
  if (!preset) {
    return;
  }
  document.getElementById("commitWithTab").checked = preset.commitWithTab;
  document.getElementById("commitWithEnter").checked = preset.commitWithEnter;
  document.getElementById("convertOnCloseColon").checked = preset.convertOnCloseColon;
  setStatus(`Applied ${mode} preset. Save to persist.`);
}

function readFromForm() {
  const values = {};
  for (const id of ids) {
    const element = document.getElementById(id);
    if (!element) {
      continue;
    }
    if (element.type === "checkbox") {
      values[id] = element.checked;
      continue;
    }
    values[id] = element.value;
  }

  values.mode = values.mode === "slack" ? "slack" : "discord";
  values.triggerMinChars = clampNumber(values.triggerMinChars, 0, 3, DEFAULT_SETTINGS.triggerMinChars);
  values.maxSuggestions = clampNumber(values.maxSuggestions, 3, 20, DEFAULT_SETTINGS.maxSuggestions);
  values.commitWithTab = Boolean(values.commitWithTab);
  values.commitWithEnter = Boolean(values.commitWithEnter);
  values.convertOnCloseColon = Boolean(values.convertOnCloseColon);
  values.insertTrailingSpace = Boolean(values.insertTrailingSpace);
  values.enableEmoticonConversion = Boolean(values.enableEmoticonConversion);

  return values;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function setStatus(message) {
  const status = document.getElementById("status");
  status.textContent = message;
  if (!message) {
    return;
  }
  window.clearTimeout(setStatus._timer);
  setStatus._timer = window.setTimeout(() => {
    status.textContent = "";
  }, 2000);
}

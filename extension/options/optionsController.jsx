/* globals React, ReactDOM, log */

// eslint-disable-next-line no-unused-vars
import * as optionsView from "./optionsView.js";
import * as settings from "../settings.js";
import { sendMessage } from "../background/communicate.js";

const { useState, useEffect, useRef } = React;
const optionsContainer = document.getElementById("options-container");

let isInitialized = false;
let onKeyboardShortcutError = () => {};
let onTabChange = () => {};
let DEFAULT_TAB = optionsView.TABS.GENERAL;

browser.runtime.onMessage.addListener(message => {
  if (message.type !== "keyboardShortcutError") {
    return;
  }
  onKeyboardShortcutError(message.error);
});

window.onhashchange = () => {
  let tab = undefined;

  if (location.hash === "#routines") {
    tab = optionsView.TABS.ROUTINES;
  } else if (location.hash === "#general") {
    tab = optionsView.TABS.GENERAL;
  } else if (location.hash === "#history") {
    tab = optionsView.TABS.HISTORY;
  }

  onTabChange(tab);
};

window.onload = () => {
  if (location.hash === "#routines") {
    DEFAULT_TAB = optionsView.TABS.ROUTINES;
  } else if (location.hash === "#history") {
    DEFAULT_TAB = optionsView.TABS.HISTORY;
  }
  onTabChange(DEFAULT_TAB);
};

async function getAudioInputDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    return null;
  }
  const audioInputDevices = [];

  const devices = await navigator.mediaDevices.enumerateDevices();
  devices.forEach(function(device) {
    if (device.kind === "audioinput") {
      audioInputDevices.push(device);
    }
  });
  return audioInputDevices;
}

function getSynthesizedVoices() {
  if (!window.speechSynthesis || !window.speechSynthesis.getVoices) {
    return null;
  }
  const voices = window.speechSynthesis.getVoices();
  return voices;
}

export const OptionsController = function() {
  const [inDevelopment, setInDevelopment] = useState(false);
  const [version, setVersion] = useState("");
  const [keyboardShortcutError, setKeyboardShortcutError] = useState(
    localStorage.getItem("keyboardShortcutError")
  );
  const [userSettings, setUserSettings] = useState({});
  const [userOptions, setUserOptions] = useState({});
  const [tabValue, setTabValue] = useState(DEFAULT_TAB);
  const [registeredNicknames, setRegisteredNicknames] = useState({});

  const [audioInputDevices, setAudioInputDevices] = useState([]);
  const [synthesizedVoices, setSynthesizedVoices] = useState([]);

  onKeyboardShortcutError = setKeyboardShortcutError;
  onTabChange = setTabValue;

  useEffect(() => {
    if (!isInitialized) {
      isInitialized = true;
      init();
    }
  });

  const init = async () => {
    await initVersionInfo();
    await initSettings();
    await initRegisteredNicknames();
    await initAudioDevices();
    initSynthesizedVoices();
  };

  const initAudioDevices = async () => {
    setAudioInputDevices(await getAudioInputDevices());
  };

  const initSynthesizedVoices = () => {
    setSynthesizedVoices(getSynthesizedVoices());
  };

  const initVersionInfo = async () => {
    setInDevelopment(
      await sendMessage({
        type: "inDevelopment",
      })
    );
    setVersion(browser.runtime.getManifest().version);
  };

  const initSettings = async () => {
    const result = await settings.getSettingsAndOptions();
    setUserSettings(result.settings);
    setUserOptions(result.options);
  };

  const initRegisteredNicknames = async () => {
    const registeredNicknames = await sendMessage({
      type: "getRegisteredNicknames",
    });

    setRegisteredNicknames(registeredNicknames);
  };

  const updateUserSettings = async userSettings => {
    await settings.saveSettings(userSettings);
    setUserSettings(userSettings);
  };

  const updateNickname = async (nicknameContext, oldNickname) => {
    const registeredNicknames = await sendMessage({
      type: "getRegisteredNicknames",
    });

    if (nicknameContext !== undefined) {
      if (
        registeredNicknames[nicknameContext.nickname] !== undefined &&
        (oldNickname === undefined || oldNickname !== nicknameContext.nickname)
      ) {
        log.error("There already is a routine with this name");
        return {
          allowed: false,
          error: "There already is a routine with this name",
        };
      }
      const contexts = [];
      const intents = nicknameContext.intents.split("\n");

      for (let i = 0; i < intents.length; i++) {
        const intent = intents[i].trim();
        if (intent.length === 0) {
          continue;
        }
        const context = await parseUtterance(intent);
        if (context === undefined || context.utterance === undefined) {
          log.error(`The intent number ${i} is not a valid intent`);
          return {
            allowed: false,
            error: `The intent number ${i + 1} is not a valid intent`,
          };
        }

        contexts.push(context);
      }

      if (contexts.length === 0) {
        log.error("No actions added for this routine");
        return { allowed: false, error: "No actions added for this routine" };
      }
      delete nicknameContext.intents;
      nicknameContext.contexts = contexts;

      await sendMessage({
        type: "registerNickname",
        name: nicknameContext.nickname,
        context: {
          slots: {},
          parameters: {},
          ...nicknameContext,
          utterance: `Combined actions named ${nicknameContext.nickname}`,
        },
      });
      // perform the same operation on local nickname
      registeredNicknames[nicknameContext.nickname] = nicknameContext;
    }
    // delete if necessary
    if (
      oldNickname !== undefined &&
      (nicknameContext === undefined ||
        oldNickname !== nicknameContext.nickname)
    ) {
      await sendMessage({
        type: "registerNickname",
        name: oldNickname,
        context: null,
      });
      // perform the same operation on local nickname
      delete registeredNicknames[oldNickname];
    }

    setRegisteredNicknames(registeredNicknames);
    return true;
  };

  const useToggle = initialIsVisible => {
    const [isVisible, setVisible] = useState(initialIsVisible);
    const ref = useRef(null);

    const handleClickOutside = event => {
      if (ref.current && !ref.current.contains(event.target)) {
        setVisible(false);
      }
    };

    const handleEscape = event => {
      if (event.key === "Escape") {
        setVisible(false);
      }
      event.preventDefault();
    };

    useEffect(() => {
      document.addEventListener("keyup", handleEscape, true);
      document.addEventListener("click", handleClickOutside, true);
      return () => {
        document.removeEventListener("click", handleClickOutside, true);
      };
    });
    return { ref, isVisible, setVisible };
  };

  const parseUtterance = async utterance => {
    return sendMessage({
      type: "parseUtterance",
      utterance,
      disableFallback: false,
    });
  };

  const useEditNicknameDraft = (initialIsVisible, initialContext) => {
    const { ref, isVisible, setVisible } = useToggle(initialIsVisible);
    const [tempEditableNickname, setTempEditableNickname] = useState({});
    const [errorMessage, setErrorMessage] = useState("");
    const copyNickname = {
      ...tempEditableNickname,
    };

    const setDraftVisibile = visible => {
      if (visible === false) {
        setVisible(false);
        return;
      }
      const copyInitialContext = JSON.parse(JSON.stringify(initialContext));
      let intents = "";
      // deep copy inital context and use that as temporary nickname for edit
      for (let i = 0; i < initialContext.contexts.length; i++) {
        intents += initialContext.contexts[i].utterance + "\n";
      }
      copyInitialContext.intents = intents;

      setTempEditableNickname(copyInitialContext);
      setVisible(visible);
    };

    return {
      ref,
      isVisible,
      setVisible: setDraftVisibile,
      tempEditableNickname: copyNickname,
      setTempEditableNickname,
      errorMessage,
      setErrorMessage,
    };
  };

  return (
    <optionsView.Options
      inDevelopment={inDevelopment}
      version={version}
      keyboardShortcutError={keyboardShortcutError}
      userOptions={userOptions}
      userSettings={{ ...userSettings }}
      updateUserSettings={updateUserSettings}
      tabValue={tabValue}
      updateNickname={updateNickname}
      registeredNicknames={registeredNicknames}
      useToggle={useToggle}
      useEditNicknameDraft={useEditNicknameDraft}
      audioInputDevices={audioInputDevices}
      synthesizedVoices={synthesizedVoices}
    />
  );
};

ReactDOM.render(<OptionsController />, optionsContainer);

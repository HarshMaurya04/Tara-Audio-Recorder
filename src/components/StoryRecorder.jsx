import { useState, useEffect, useRef, useCallback } from "react";
import {
  Button,
  IconButton,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Select,
  FormControl,
  InputLabel,
  MenuItem,
  OutlinedInput,
  InputAdornment,
} from "@mui/material";
import { uploadAudioToBackend } from "../services/api";

import MicIcon from "@mui/icons-material/Mic";
import SettingsIcon from "@mui/icons-material/Settings";
import CloseIcon from "@mui/icons-material/Close";

const STORY_DATA = {
  id: "EN-OL-RC-247-1",
  title: "The Dam and the River",
  lang: "EN",
  text: `A dam is a wall built across a river. When it rains, a lot of water goes down the river and into the sea. The dam stops the water. The water then becomes a big lake behind the dam. Later this water is let out into the fields. There it helps crops like rice to grow.`,
};

// Default audio recording configuration
const defaultMimeType = "audio/webm"; // Recording format
const defaultBitrate = 64000; // Audio quality
const maxRecordingTime = 60; // Max recording time (seconds)

// Text auto-fit limits
const minFontSize = 18;
const maxFontSize = 30;

// Exit fullscreen safely (cross-browser support)
const exitFullscreen = () => {
  if (document.exitFullscreen) {
    document.exitFullscreen();
  } else if (document.webkitExitFullscreen) {
    document.webkitExitFullscreen(); // Safari
  } else if (document.mozCancelFullScreen) {
    document.mozCancelFullScreen(); // Firefox
  } else if (document.msExitFullscreen) {
    document.msExitFullscreen(); // IE/Edge
  }
};

// Check if browser is currently in fullscreen mode
const isFullscreen = () => {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement || // Safari
    document.mozFullScreenElement || // Firefox
    document.msFullscreenElement // IE/Edge
  );
};

const StoryRecorder = ({ details = {} }) => {
  const story = STORY_DATA;

  // Converts seconds into MM:SS format
  const formatTime = useCallback(
    (s) =>
      `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`,
    [],
  );

  const [isRecording, setIsRecording] = useState(false); // Is recording active?
  const [timer, setTimer] = useState(0); // Recording timer
  const [showText, setShowText] = useState(true); // Controls story visibility
  const [initializing, setInitializing] = useState(false); // Prevent double start
  const [stopping, setStopping] = useState(false); // Stop delay state

  // Permission & Device State
  const [recorderSupported, setRecorderSupported] = useState(true);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [micModalOpen, setMicModalOpen] = useState(false);
  const [inputDevices, setInputDevices] = useState([]);
  const [inputDevicesLoading, setInputDevicesLoading] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);

  const [audioBlob, setAudioBlob] = useState(null); // Final recorded blob
  const [audioURL, setAudioURL] = useState(null); // For playback
  const [submitted, setSubmitted] = useState(false); // Toggle between record view & review view
  const [sending, setSending] = useState(false); // Submission loading

  const [dynamicFontSize, setDynamicFontSize] = useState(32); // Dynamic Text Fit

  const storyContainerRef = useRef(null); // Story box DOM
  const measureRef = useRef(null); // Hidden measurement div
  const canvasRef = useRef(null); // Waveform canvas
  const mediaRecorderRef = useRef(null); // MediaRecorder instance
  const streamRef = useRef(null); // Mic stream
  const analyserRef = useRef(null); // Audio analyser

  const isMountedRef = useRef(true);
  const animationRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const dataArrayRef = useRef(null);

  // Automatically adjusts font size so text fits inside story box
  const fitTextToContainer = useCallback(() => {
    if (!storyContainerRef.current || !measureRef.current || !story.text)
      return;

    const container = storyContainerRef.current;
    const measurer = measureRef.current;

    const containerStyles = window.getComputedStyle(container);

    const paddingTop = parseFloat(containerStyles.paddingTop);
    const paddingBottom = parseFloat(containerStyles.paddingBottom);
    const paddingLeft = parseFloat(containerStyles.paddingLeft);
    const paddingRight = parseFloat(containerStyles.paddingRight);

    const availableWidth = container.clientWidth - paddingLeft - paddingRight;
    const availableHeight = container.clientHeight - paddingTop - paddingBottom;

    measurer.style.position = "absolute";
    measurer.style.visibility = "hidden";
    measurer.style.width = `${availableWidth}px`;
    measurer.style.whiteSpace = "pre-wrap";
    measurer.style.wordWrap = "break-word";
    measurer.style.padding = "0";
    measurer.style.margin = "0";
    measurer.style.border = "none";

    measurer.textContent = story.text;

    let min = minFontSize;
    let max = maxFontSize;
    let best = minFontSize;

    while (min <= max) {
      const mid = Math.floor((min + max) / 2);
      measurer.style.fontSize = `${mid}px`;

      if (measurer.scrollHeight <= availableHeight) {
        best = mid;
        min = mid + 1;
      } else {
        max = mid - 1;
      }
    }

    setDynamicFontSize(best);
  }, [story.text]);

  useEffect(() => {
    requestAnimationFrame(() => {
      fitTextToContainer();
    });

    window.addEventListener("resize", fitTextToContainer);

    return () => {
      window.removeEventListener("resize", fitTextToContainer);
    };
  }, [fitTextToContainer]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // exit fullscreen on unmount
      if (isFullscreen()) exitFullscreen();
    };
  }, []);

  // Central cleanup for recording resources
  const cleanupRecording = () => {
    if (streamRef.current) {
      // Stop and clean up audio stream
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      // Close audio context
      if (audioContextRef.current.state !== "closed") {
        audioContextRef.current.close();
      }
      audioContextRef.current = null;
    }
    if (animationRef.current) {
      // Cancel animation frame
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (timerIntervalRef.current) {
      // Clear timer interval
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (mediaRecorderRef.current) {
      // Clear MediaRecorder context
      if (mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop(); // stop if recording
      }
      mediaRecorderRef.current = null;
    }
    setTimer(0);
  };

  const loadInputDevices = useCallback(async () => {
    setInputDevicesLoading(true); // Start loading
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(
      (device) => device.kind === "audioinput",
    );
    const filtered = audioInputs.filter((device) => {
      // Remove empty labels
      const label = device.label?.trim();
      if (!label) return false;
      // Exclude common "virtual" or "default" device names if you want
      const lowerLabel = device.label.toLowerCase();
      if (
        lowerLabel.includes("virtual") ||
        lowerLabel.includes("stereo mix") ||
        lowerLabel.includes("default") ||
        lowerLabel.includes("communications device") ||
        lowerLabel.includes("communications")
      )
        return false;
      return true;
    });
    // Remove duplicates by label
    const uniqueDevices = [];
    filtered.forEach((device) => {
      if (!uniqueDevices.some((d) => d.label === device.label)) {
        uniqueDevices.push(device);
      }
    });
    // Sort by label
    uniqueDevices.sort((a, b) => a.label.localeCompare(b.label));

    setInputDevices(uniqueDevices);
    setInputDevicesLoading(false); // Done loading

    // Attempt to retrieve previously selected mic device ID from localStorage
    const savedDeviceId = localStorage.getItem("selectedMicDeviceId");
    const foundDevice = uniqueDevices.find((d) => d.deviceId === savedDeviceId);

    // If saved device ID exists and is found in current device list, restore selection
    if (savedDeviceId && foundDevice) {
      // Only set if different
      setSelectedDeviceId((prev) =>
        prev !== savedDeviceId ? savedDeviceId : prev,
      );
    } else if (savedDeviceId && !foundDevice) {
      localStorage.removeItem("selectedMicDeviceId");
      alert(
        "Previously selected microphone is no longer available. Switching to the default microphone.",
      );
      const fallbackId = uniqueDevices[0]?.deviceId;
      if (fallbackId) setSelectedDeviceId(fallbackId);
    } else if (!savedDeviceId && uniqueDevices.length > 0) {
      // Only set a mic if no mic is currently selected or selected mic is now missing
      setSelectedDeviceId((prev) => {
        const stillValid = uniqueDevices.some((d) => d.deviceId === prev);
        if (!stillValid) {
          if (prev !== null) {
            alert(
              "Selected microphone is no longer available. Switching to a default microphone.",
            );
          }
          return uniqueDevices[0]?.deviceId || null;
        }
        return prev;
      });
    }
    // return true if valid devices are found
    return uniqueDevices.length > 0;
  }, []);

  const checkSupportAndPermission = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setRecorderSupported(false);
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      setRecorderSupported(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      const hasDevices = await loadInputDevices();
      setPermissionGranted(hasDevices);
    } catch {
      setPermissionGranted(false);
    }
  }, [loadInputDevices]);

  useEffect(() => {
    checkSupportAndPermission();

    return () => {
      cleanupRecording();
    };
  }, [checkSupportAndPermission]);

  const requestMicPermission = useCallback(() => {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(async (stream) => {
        stream.getTracks().forEach((track) => track.stop());
        const hasDevices = await loadInputDevices();
        setPermissionGranted(hasDevices);
      })
      .catch((e) => {
        console.log("mic permission error: ", e);
        setPermissionGranted(false);
        // Show an alert on explicit denial
        if (e.name === "NotAllowedError" || e.name === "SecurityError") {
          alert(
            "Microphone access was denied. Please allow microphone permission in your browser settings.",
          );
        } else {
          alert("An error occurred while requesting microphone access.");
        }
      });
  }, [loadInputDevices]);

  const drawWaveform = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;

    if (!canvas || !ctx || !analyser || !dataArray) return;

    const bufferLength = analyser.fftSize;

    const draw = () => {
      if (!analyserRef.current || !dataArrayRef.current || !canvasRef.current)
        return;

      animationRef.current = requestAnimationFrame(draw);

      analyser.getByteTimeDomainData(dataArray);
      ctx.fillStyle = "#f9f9f9";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#0077cc";
      ctx.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    draw();
  };

  const startRecording = async () => {
    if (!permissionGranted) {
      setMicModalOpen(true);
      return;
    }
    // Prevent duplicate starts
    if (isRecording || initializing) return;

    setAudioBlob(null);
    setAudioURL(null);
    setInitializing(true);
    setShowText(true);
    setTimer(0);

    try {
      const options = {
        mimeType: defaultMimeType,
        audioBitsPerSecond: defaultBitrate,
      };

      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        alert(`MIME type not supported: ${options.mimeType}`);
        stopRecording();
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
        },
      });
      const trackSettings = stream.getAudioTracks()[0]?.getSettings?.() || null;
      setIsRecording(true);
      streamRef.current = stream;
      audioChunksRef.current = [];

      audioContextRef.current = new (
        window.AudioContext || window.webkitAudioContext
      )();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 1024; // decrease this if high res is not needed to 1024 or 512
      dataArrayRef.current = new Uint8Array(analyserRef.current.fftSize);
      source.connect(analyserRef.current);

      drawWaveform();

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, {
          type: options.mimeType,
        });

        setAudioBlob(blob);
        setAudioURL(URL.createObjectURL(blob));

        if (isMountedRef.current) {
          setStopping(false);
        }
        audioChunksRef.current = [];
        cleanupRecording(); // <-- Centralized cleanup
      };

      mediaRecorder.start();
    } catch (err) {
      console.error("Recording error:", err);
      alert("Microphone access failed.");
      setIsRecording(false);
      cleanupRecording(); // <-- On error cleanup
    } finally {
      setInitializing(false);
    }
  };

  const stopRecording = useCallback(() => {
    try {
      if (mediaRecorderRef.current && isRecording) {
        setStopping(true);
        setIsRecording(false);
        // Delay stopping by 1 second
        setTimeout(() => {
          setShowText(false); // hide text after recording stops
          mediaRecorderRef.current?.stop();
        }, 1000);
      }
    } catch (e) {
      console.error("Failed to stop recorder:", e);
      alert("An error occurred while stopping the recording.");
    }
  }, [isRecording]);

  // Modal close handler
  const closeMicModal = () => {
    setMicModalOpen(false);
  };

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;

    const handleDeviceChange = async () => {
      await loadInputDevices();
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange,
      );
    };
  }, [loadInputDevices]);

  useEffect(() => {
    if (!isRecording) return;
    // Timer interval - increments every second
    const intervalId = setInterval(() => {
      setTimer((prev) => {
        const next = prev + 1;
        if (next > maxRecordingTime) {
          // your max recording time
          stopRecording();
          return prev; // prevent timer going beyond max
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [isRecording, stopRecording]);

  useEffect(() => {
    if (!isRecording) return;
    // Stop recording if tab becomes inactive
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopRecording();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isRecording, stopRecording]);

  // When audioBlob becomes null (Retry clicked), show story text again
  useEffect(() => {
    if (!audioBlob) {
      setShowText(true);
    }
  }, [audioBlob]);

  const closeWebView = () => {
    if (window.BotExtension?.close) {
      window.BotExtension.close();
    } else {
      window.history.back(); // fallback
    }
  };

  const handleFinalSubmit = async () => {
  if (!audioBlob) {
    alert("No audio recorded");
    return;
  }

  setSending(true);

  if (typeof window.BotExtension !== "undefined") {

    window.BotExtension.getPayload(async (userPhone) => {
      console.log("User phone from payload:", userPhone);

      if (!userPhone || !userPhone.value) {
        alert("Sender not found in payload");
        setSending(false);
        return;
      }

      try {
        // 🔥 Upload audio
        await uploadAudioToBackend(audioBlob, userPhone.value);

        // ✅ Close WebView after success
        window.BotExtension.close();

      } catch (err) {
        console.error("Upload failed:", err);
        alert("Upload failed");
        window.BotExtension.close();
      }

      setSending(false);
    });

  } else {
    alert("SDK not available");
    setSending(false);
  }
};


  return (
    <>
      {!submitted ? (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            background: "#f4f6f9",
            padding: "20px",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "850px",
              background: "#ffffff",
              borderRadius: "24px",
              padding: "40px 80px",
              boxShadow: "0 15px 40px rgba(0,0,0,0.08)",
              display: "flex",
              flexDirection: "column",
              gap: "30px",
            }}
          >
            {/* Mic Modal */}
            <Dialog
              open={micModalOpen}
              onClose={closeMicModal}
              aria-labelledby="mic-dialog-title"
              role="dialog"
              maxWidth="sm"
              fullWidth
            >
              <DialogTitle id="mic-dialog-title">
                <b>Microphone Settings</b>
                <IconButton
                  aria-label="Close Dialog"
                  title="Close Dialog"
                  onClick={closeMicModal}
                  sx={{
                    position: "absolute",
                    right: 8,
                    top: 8,
                  }}
                >
                  <CloseIcon />
                </IconButton>
              </DialogTitle>
              <DialogContent dividers aria-describedby="mic-dialog-description">
                {!recorderSupported ? (
                  <Alert severity="error">
                    Your browser does not support audio recording.
                  </Alert>
                ) : !permissionGranted ? (
                  <>
                    <Alert severity="error" style={{ marginBottom: "1rem" }}>
                      Please grant microphone access to use this feature.
                    </Alert>
                    <Button
                      variant="contained"
                      color="primary"
                      onClick={requestMicPermission}
                    >
                      Enable Microphone
                    </Button>
                  </>
                ) : inputDevicesLoading ? (
                  <Alert severity="info">Detecting microphones...</Alert>
                ) : inputDevices.length === 0 ? (
                  <>
                    <Alert severity="warning" style={{ marginBottom: "1rem" }}>
                      No microphone found. Please connect one and try again.
                    </Alert>
                    <Button
                      variant="contained"
                      color="warning"
                      size="small"
                      onClick={loadInputDevices}
                    >
                      Retry
                    </Button>
                  </>
                ) : (
                  <>
                    <FormControl fullWidth size="small">
                      <InputLabel id="mic-selector-label">
                        Select Microphone
                      </InputLabel>
                      <Select
                        labelId="mic-selector-label"
                        aria-label="Select a microphone input"
                        inputProps={{
                          "aria-label": "Microphone device selector",
                        }}
                        id="mic-selector"
                        value={selectedDeviceId || ""}
                        onChange={(e) => {
                          const newId = e.target.value;
                          if (isRecording) stopRecording(); // Stop recording if currently recording
                          setSelectedDeviceId(newId);
                          localStorage.setItem("selectedMicDeviceId", newId); // persist on selection change
                        }}
                        label="Select Microphone"
                        input={
                          <OutlinedInput
                            label="Select Microphone"
                            startAdornment={
                              <InputAdornment position="start">
                                <MicIcon fontSize="small" />
                              </InputAdornment>
                            }
                          />
                        }
                      >
                        {inputDevices.map((device) => (
                          <MenuItem
                            key={device.deviceId}
                            value={device.deviceId}
                          >
                            {device.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </>
                )}
              </DialogContent>
              <DialogActions>
                <Button variant="contained" onClick={closeMicModal} autoFocus>
                  Done
                </Button>
              </DialogActions>
            </Dialog>

            {/* Top Info Row: Count | Title | Mic Info */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 0",
                borderBottom: "1px solid #eee",
                marginBottom: 12,
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              {/* Story title */}
              <div
                style={{
                  fontWeight: "bold",
                  fontSize: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: 1,
                  color: "#333",
                }}
              >
                {/* Details */}
                <div
                  style={{
                    fontSize: 14,
                    color: "#666",
                    display: "flex",
                    alignItems: "center",
                    flex: 1,
                    justifyContent: "flex-start",
                    gap: "1rem",
                  }}
                >
                  <p style={{ color: "#7ed46a" }}>{details.fullName}</p>
                  <p>
                    Class: {details.std} | Section: {details.divn} | Roll No:{" "}
                    {details.rollNo}
                  </p>
                </div>

                {story.title ? story.title : "Untitled Story"}

                {/* Mic info */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flex: 1,
                    justifyContent: "flex-end",
                    flexWrap: "wrap",
                  }}
                >
                  <IconButton
                    aria-label="Open microphone settings"
                    size="small"
                    color="info"
                    onClick={() => setMicModalOpen(true)}
                    sx={{ padding: "0 5px" }}
                    title="Microphone Settings"
                  >
                    <SettingsIcon />
                  </IconButton>
                </div>
              </div>
            </div>

            {/* Story Box */}
            <div
              ref={storyContainerRef}
              className={story.lang !== "EN" ? "font-devanagari" : undefined}
              style={{
                backgroundColor: "#ffffff",
                height: "300px",
                borderRadius: "20px",
                border: "3px solid #2f80ed",
                boxShadow:
                  "0 4px 8px rgba(0,0,0,0.05), 0 15px 35px rgba(0,0,0,0.08)",
                padding: "50px 60px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                textAlign: "center",
              }}
            >
              {showText && (
                <p
                  style={{
                    fontSize: dynamicFontSize,
                    margin: 0,
                    color: "#7a7a7a",
                    fontWeight: 500,
                    lineHeight: 1.6,
                  }}
                >
                  {story.text || "Your story paragraph here"}
                </p>
              )}
            </div>

            {/* Control Row */}
            <div
              style={{ display: "flex", alignItems: "center", marginTop: 20 }}
            >
              {/* Left: Timer and waveform */}
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: "1rem",
                }}
              >
                <span
                  style={{ fontSize: 16, width: 50 }}
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {formatTime(timer)}
                </span>
                <canvas
                  ref={canvasRef}
                  width={200}
                  height={40}
                  style={{
                    background: "linear-gradient(to bottom, #fff, #f1f1f1)",
                    borderRadius: 4,
                    border: "1px solid #ddd",
                  }}
                  aria-hidden="true"
                />
              </div>

              {/* Center: Start/Stop and Next/Submit */}
              <div style={{ flex: 1, textAlign: "center" }}>
                {!isRecording ? (
                  <Button
                    variant="contained"
                    onClick={startRecording}
                    disabled={
                      initializing || stopping || isRecording || audioBlob
                    }
                    sx={{
                      backgroundColor: "#007bff",
                      borderRadius: "30px",
                      textTransform: "none",
                      fontWeight: "600",
                      color: "#fff",
                      boxShadow: "0 4px 10px rgba(0, 119, 255, 0.3)",
                      transition: "all 0.2s ease-in-out",
                      "&:hover": {
                        backgroundColor: "#0066dd",
                        boxShadow: "0 6px 14px rgba(0, 102, 221, 0.35)",
                        transform: "scale(1.03)",
                      },
                    }}
                  >
                    {initializing ? (
                      <CircularProgress
                        size={20}
                        sx={{ color: "#fff", display: "block" }}
                      />
                    ) : (
                      "Start"
                    )}
                    {/* <CircularProgress size={20} sx={{ color: '#fff' }} />  */}
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    // color="error"
                    onClick={stopRecording}
                    sx={{
                      backgroundColor: "#ef5350", // red base for stop
                      borderRadius: "30px",
                      textTransform: "none",
                      fontWeight: "600",
                      color: "#fff",
                      boxShadow: "0 4px 10px rgba(239, 83, 80, 0.3)",
                      transition: "all 0.2s ease-in-out",
                      "&:hover": {
                        backgroundColor: "#d32f2f", // darker red on hover
                        boxShadow: "0 6px 14px rgba(211, 47, 47, 0.35)",
                        transform: "scale(1.03)",
                      },
                    }}
                  >
                    Stop
                  </Button>
                )}

                {audioBlob && !isRecording && (
                  <Button
                    variant="contained"
                    onClick={() => setSubmitted(true)}
                    sx={{
                      marginLeft: 2,
                      backgroundColor: "#4caf50",
                      borderRadius: "30px",
                      textTransform: "none",
                      fontWeight: "600",
                      boxShadow: "0 4px 12px rgba(76,175,80,0.3)",
                      "&:hover": {
                        backgroundColor: "#43a047",
                      },
                    }}
                  >
                    Finish
                  </Button>
                )}
              </div>

              {/* RIGHT (empty for now if single recording) */}
              <div style={{ flex: 1 }} />

              {/* Right: Delete */}
              {/* <div
              style={{
                flex: 1,
                textAlign: "right",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: "0.5rem",
              }}
            >
              <IconButton
                onClick={handleDelete}
                disabled={!recordings[currentParaIndex] || uploaded}
                color="error"
                aria-label={`Delete recording for paragraph ${currentParaIndex + 1}`}
                title="Delete this recording"
              >
                <DeleteIcon />
              </IconButton>
              
              // Paragraph count 
              <div
                style={{ fontSize: 14, color: "#666", fontWeight: "bold" }}
                aria-live="polite"
              >
                Paragraph {currentParaIndex + 1} / {paragraphs.length}
                <LinearProgress
                  variant="determinate"
                  value={((currentParaIndex + 1) / paragraphs.length) * 100}
                  aria-label="Recording progress"
                  aria-valuenow={currentParaIndex + 1}
                  aria-valuemin={1}
                  aria-valuemax={paragraphs.length}
                />
              </div>
            </div> */}
            </div>
          </div>
          {/* Hidden measurer */}
          <div
            ref={measureRef}
            className={story.lang !== "EN" ? "font-devanagari" : undefined}
            style={{
              position: "absolute",
              visibility: "hidden",
              zIndex: -1,
              height: "auto",
              width: "100%",
              pointerEvents: "none",
              whiteSpace: "pre-wrap",
              wordWrap: "break-word",
            }}
          />
        </div>
      ) : (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            background: "#f4f6f9",
            padding: "20px",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "400px",
              backgroundColor: "#ffffff",
              padding: "48px 40px",
              borderRadius: "28px",
              boxShadow: "0 20px 50px rgba(0,0,0,0.08)",
              textAlign: "center",
            }}
          >
            {!sending ? (
              <>
                <h2 style={{ textAlign: "center", marginBottom: "40px" }}>
                  Recorded Audio
                </h2>

                <div style={{ textAlign: "center" }}>
                  {audioURL && (
                    <audio controls src={audioURL} style={{ width: "100%" }} />
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    gap: "20px",
                    marginTop: "30px",
                  }}
                >
                  <Button
                    variant="contained"
                    sx={{
                      backgroundColor: "#ef5350",
                      borderRadius: "30px",
                      textTransform: "none",
                    }}
                    onClick={() => {
                      setAudioBlob(null);
                      setAudioURL(null);
                      setSubmitted(false);
                    }}
                  >
                    Retry
                  </Button>

                  <Button
                    variant="contained"
                    sx={{
                      backgroundColor: "#1976d2",
                      borderRadius: "30px",
                      textTransform: "none",
                    }}
                    onClick={handleFinalSubmit}
                  >
                    Submit Attempt
                  </Button>
                </div>
              </>
            ) : (
              <div style={{ textAlign: "center" }}>
                <Alert severity="success" sx={{ mb: 3 }}>
                  Recording uploaded successfully!
                </Alert>

                <h3>{details.fullName}</h3>
                <p>has completed</p>
                <strong>{story.title}</strong>

                <Button
                  variant="contained"
                  sx={{
                    marginTop: "20px",
                    borderRadius: "30px",
                    textTransform: "none",
                  }}
                  onClick={() => {
                    setAudioBlob(null);
                    setAudioURL(null);
                    setSubmitted(false);
                  }}
                >
                  Record Again
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default StoryRecorder;

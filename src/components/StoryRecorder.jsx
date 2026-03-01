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
const defaultMimeType = "audio/webm";
const defaultBitrate = 64000;
const maxRecordingTime = 60;

// Text auto-fit limits
const minFontSize = 18;
const maxFontSize = 30;

const exitFullscreen = () => {
  if (document.exitFullscreen) {
    document.exitFullscreen();
  } else if (document.webkitExitFullscreen) {
    document.webkitExitFullscreen();
  } else if (document.mozCancelFullScreen) {
    document.mozCancelFullScreen();
  } else if (document.msExitFullscreen) {
    document.msExitFullscreen();
  }
};

const isFullscreen = () => {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
};

const StoryRecorder = ({ details = {} }) => {
  const story = STORY_DATA;

  const formatTime = useCallback(
    (s) =>
      `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`,
    [],
  );

  const [isRecording, setIsRecording] = useState(false);
  const [timer, setTimer] = useState(0);
  const [showText, setShowText] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [stopping, setStopping] = useState(false);

  const [recorderSupported, setRecorderSupported] = useState(true);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [micModalOpen, setMicModalOpen] = useState(false);
  const [inputDevices, setInputDevices] = useState([]);
  const [inputDevicesLoading, setInputDevicesLoading] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);

  const [audioBlob, setAudioBlob] = useState(null);
  const [audioURL, setAudioURL] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  const [dynamicFontSize, setDynamicFontSize] = useState(32);

  const storyContainerRef = useRef(null);
  const measureRef = useRef(null);
  const canvasRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const analyserRef = useRef(null);

  const isMountedRef = useRef(true);
  const animationRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const dataArrayRef = useRef(null);

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
      if (isFullscreen()) exitFullscreen();
    };
  }, []);

  const cleanupRecording = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      if (audioContextRef.current.state !== "closed") {
        audioContextRef.current.close();
      }
      audioContextRef.current = null;
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
    }
    setTimer(0);
  };

  const loadInputDevices = useCallback(async () => {
    setInputDevicesLoading(true);
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(
      (device) => device.kind === "audioinput",
    );
    const filtered = audioInputs.filter((device) => {
      const label = device.label?.trim();
      if (!label) return false;
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
    const uniqueDevices = [];
    filtered.forEach((device) => {
      if (!uniqueDevices.some((d) => d.label === device.label)) {
        uniqueDevices.push(device);
      }
    });
    uniqueDevices.sort((a, b) => a.label.localeCompare(b.label));

    setInputDevices(uniqueDevices);
    setInputDevicesLoading(false);

    const savedDeviceId = localStorage.getItem("selectedMicDeviceId");
    const foundDevice = uniqueDevices.find((d) => d.deviceId === savedDeviceId);

    if (savedDeviceId && foundDevice) {
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
      setIsRecording(true);
      streamRef.current = stream;
      audioChunksRef.current = [];

      audioContextRef.current = new (
        window.AudioContext || window.webkitAudioContext
      )();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 1024;
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
        cleanupRecording();
      };

      mediaRecorder.start();
    } catch (err) {
      console.error("Recording error:", err);
      alert("Microphone access failed.");
      setIsRecording(false);
      cleanupRecording();
    } finally {
      setInitializing(false);
    }
  };

  const stopRecording = useCallback(() => {
    try {
      if (mediaRecorderRef.current && isRecording) {
        setStopping(true);
        setIsRecording(false);
        setTimeout(() => {
          setShowText(false);
          mediaRecorderRef.current?.stop();
        }, 1000);
      }
    } catch (e) {
      console.error("Failed to stop recorder:", e);
      alert("An error occurred while stopping the recording.");
    }
  }, [isRecording]);

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
    const intervalId = setInterval(() => {
      setTimer((prev) => {
        const next = prev + 1;
        if (next > maxRecordingTime) {
          stopRecording();
          return prev;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [isRecording, stopRecording]);

  useEffect(() => {
    if (!isRecording) return;
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

  useEffect(() => {
    if (!audioBlob) {
      setShowText(true);
    }
  }, [audioBlob]);

  const closeWebView = () => {
    if (window.BotExtension?.close) {
      window.BotExtension.close();
    } else {
      window.history.back();
    }
  };

  const waitForBotExtension = () => {
    return new Promise((resolve, reject) => {
      let attempts = 0;

      const interval = setInterval(() => {
        if (window.BotExtension && window.BotExtension.getPayload) {
          clearInterval(interval);
          resolve(window.BotExtension);
        }

        attempts++;

        if (attempts > 50) {
          clearInterval(interval);
          reject("BotExtension SDK not loaded");
        }
      }, 100);
    });
  };

  const handleFinalSubmit = async () => {
    if (!audioBlob) {
      alert("No audio recorded");
      return;
    }

    setSending(true);

    try {
      const sdk = await waitForBotExtension();

      sdk.getPayload(async (payload) => {
        console.log("Payload received:", payload);

        if (!payload || !payload.value) {
          alert("Sender not found in payload");
          setSending(false);
          return;
        }

        try {
          await uploadAudioToBackend(audioBlob, payload.value);
          sdk.close();
        } catch (err) {
          console.error("Upload failed:", err);
          alert("Upload failed");
          sdk.close();
        }

        setSending(false);
      });
    } catch (err) {
      console.error("SDK error:", err);
      alert("SDK not ready. Please try again.");
      setSending(false);
    }
  };

  // ─── Responsive styles ───────────────────────────────────────────────────────
  const styles = {
    pageWrapper: {
      minHeight: "100vh",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      background: "#f4f6f9",
      padding: "16px",
      boxSizing: "border-box",
    },
    card: {
      width: "100%",
      maxWidth: "850px",
      background: "#ffffff",
      borderRadius: "20px",
      padding: "clamp(20px, 4vw, 40px) clamp(16px, 6vw, 80px)",
      boxShadow: "0 15px 40px rgba(0,0,0,0.08)",
      display: "flex",
      flexDirection: "column",
      gap: "clamp(16px, 3vw, 30px)",
      boxSizing: "border-box",
    },
    headerRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      padding: "0 0 12px 0",
      borderBottom: "1px solid #eee",
      gap: 12,
      flexWrap: "wrap",
    },
    detailsBlock: {
      fontSize: "clamp(11px, 1.5vw, 14px)",
      color: "#666",
      display: "flex",
      flexDirection: "column",
      gap: 2,
      minWidth: 0,
      flex: "1 1 120px",
    },
    studentName: {
      color: "#5cb85c",
      fontWeight: 600,
      margin: 0,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    studentMeta: {
      margin: 0,
      lineHeight: 1.4,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    storyTitle: {
      fontWeight: "bold",
      fontSize: "clamp(14px, 2vw, 17px)",
      color: "#333",
      textAlign: "center",
      flex: "1 1 auto",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      padding: "0 8px",
    },
    settingsBtn: {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      flex: "0 0 auto",
    },
    storyBox: {
      backgroundColor: "#ffffff",
      height: "clamp(180px, 30vw, 300px)",
      borderRadius: "16px",
      border: "3px solid #2f80ed",
      boxShadow: "0 4px 8px rgba(0,0,0,0.05), 0 15px 35px rgba(0,0,0,0.08)",
      padding: "clamp(20px, 4vw, 50px) clamp(16px, 5vw, 60px)",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      textAlign: "center",
      boxSizing: "border-box",
    },
    controlRow: {
      display: "flex",
      alignItems: "center",
      flexWrap: "wrap",
      gap: "12px",
      marginTop: 8,
    },
    timerWaveform: {
      display: "flex",
      alignItems: "center",
      gap: "0.75rem",
      flex: "1 1 auto",
      minWidth: 0,
    },
    timerText: {
      fontSize: "clamp(13px, 2vw, 16px)",
      fontVariantNumeric: "tabular-nums",
      minWidth: 42,
      flexShrink: 0,
    },
    canvas: {
      background: "linear-gradient(to bottom, #fff, #f1f1f1)",
      borderRadius: 4,
      border: "1px solid #ddd",
      width: "clamp(80px, 20vw, 200px)",
      height: 40,
      flexShrink: 0,
    },
    btnGroup: {
      display: "flex",
      gap: "10px",
      justifyContent: "center",
      flexShrink: 0,
    },
    startBtn: {
      backgroundColor: "#007bff",
      borderRadius: "30px",
      textTransform: "none",
      fontWeight: "600",
      color: "#fff",
      boxShadow: "0 4px 10px rgba(0, 119, 255, 0.3)",
      transition: "all 0.2s ease-in-out",
      fontSize: "clamp(13px, 1.5vw, 15px)",
      padding: "6px 20px",
      "&:hover": {
        backgroundColor: "#0066dd",
        boxShadow: "0 6px 14px rgba(0, 102, 221, 0.35)",
        transform: "scale(1.03)",
      },
    },
    stopBtn: {
      backgroundColor: "#ef5350",
      borderRadius: "30px",
      textTransform: "none",
      fontWeight: "600",
      color: "#fff",
      boxShadow: "0 4px 10px rgba(239, 83, 80, 0.3)",
      transition: "all 0.2s ease-in-out",
      fontSize: "clamp(13px, 1.5vw, 15px)",
      padding: "6px 20px",
      "&:hover": {
        backgroundColor: "#d32f2f",
        boxShadow: "0 6px 14px rgba(211, 47, 47, 0.35)",
        transform: "scale(1.03)",
      },
    },
    finishBtn: {
      backgroundColor: "#4caf50",
      borderRadius: "30px",
      textTransform: "none",
      fontWeight: "600",
      boxShadow: "0 4px 12px rgba(76,175,80,0.3)",
      fontSize: "clamp(13px, 1.5vw, 15px)",
      padding: "6px 20px",
      "&:hover": {
        backgroundColor: "#43a047",
      },
    },
    // Review card
    reviewWrapper: {
      minHeight: "100vh",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      background: "#f4f6f9",
      padding: "16px",
      boxSizing: "border-box",
    },
    reviewCard: {
      width: "100%",
      maxWidth: "440px",
      backgroundColor: "#ffffff",
      padding: "clamp(28px, 5vw, 48px) clamp(20px, 5vw, 40px)",
      borderRadius: "24px",
      boxShadow: "0 20px 50px rgba(0,0,0,0.08)",
      textAlign: "center",
      boxSizing: "border-box",
    },
    reviewTitle: {
      textAlign: "center",
      marginBottom: "clamp(20px, 4vw, 40px)",
      fontSize: "clamp(18px, 3vw, 24px)",
    },
    reviewAudio: {
      width: "100%",
      marginBottom: "4px",
    },
    reviewBtnRow: {
      display: "flex",
      justifyContent: "center",
      gap: "clamp(10px, 3vw, 20px)",
      marginTop: "clamp(16px, 3vw, 30px)",
      flexWrap: "wrap",
    },
    retryBtn: {
      backgroundColor: "#ef5350",
      borderRadius: "30px",
      textTransform: "none",
      fontSize: "clamp(13px, 1.5vw, 15px)",
    },
    submitBtn: {
      backgroundColor: "#1976d2",
      borderRadius: "30px",
      textTransform: "none",
      fontSize: "clamp(13px, 1.5vw, 15px)",
    },
    recordAgainBtn: {
      marginTop: "20px",
      borderRadius: "30px",
      textTransform: "none",
      fontSize: "clamp(13px, 1.5vw, 15px)",
    },
  };
  // ────────────────────────────────────────────────────────────────────────────

  return (
    <>
      {!submitted ? (
        <div style={styles.pageWrapper}>
          <div style={styles.card}>
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
                  sx={{ position: "absolute", right: 8, top: 8 }}
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
                        if (isRecording) stopRecording();
                        setSelectedDeviceId(newId);
                        localStorage.setItem("selectedMicDeviceId", newId);
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
                        <MenuItem key={device.deviceId} value={device.deviceId}>
                          {device.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </DialogContent>
              <DialogActions>
                <Button variant="contained" onClick={closeMicModal} autoFocus>
                  Done
                </Button>
              </DialogActions>
            </Dialog>

            {/* Header Row */}
            <div style={styles.headerRow}>
              {/* Student details */}
              <div style={styles.detailsBlock}>
                <p style={styles.studentName}>{details.fullName}</p>
                <p style={styles.studentMeta}>
                  Class: {details.std} &nbsp;|&nbsp; Section: {details.divn}{" "}
                  &nbsp;|&nbsp; Roll No: {details.rollNo}
                </p>
              </div>

              {/* Story title */}
              <div style={styles.storyTitle}>
                {story.title ? story.title : "Untitled Story"}
              </div>

              {/* Settings icon */}
              <div style={styles.settingsBtn}>
                <IconButton
                  aria-label="Open microphone settings"
                  size="small"
                  color="info"
                  onClick={() => setMicModalOpen(true)}
                  title="Microphone Settings"
                >
                  <SettingsIcon />
                </IconButton>
              </div>
            </div>

            {/* Story Box */}
            <div
              ref={storyContainerRef}
              className={story.lang !== "EN" ? "font-devanagari" : undefined}
              style={styles.storyBox}
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

            {/* Controls */}
            <div style={styles.controlRow}>
              {/* Timer + Waveform */}
              <div style={styles.timerWaveform}>
                <span
                  style={styles.timerText}
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {formatTime(timer)}
                </span>
                <canvas
                  ref={canvasRef}
                  width={200}
                  height={40}
                  style={styles.canvas}
                  aria-hidden="true"
                />
              </div>

              {/* Start / Stop + Finish */}
              <div style={styles.btnGroup}>
                {!isRecording ? (
                  <Button
                    variant="contained"
                    onClick={startRecording}
                    disabled={
                      initializing || stopping || isRecording || audioBlob
                    }
                    sx={styles.startBtn}
                  >
                    {initializing ? (
                      <CircularProgress
                        size={18}
                        sx={{ color: "#fff", display: "block" }}
                      />
                    ) : (
                      "Start"
                    )}
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    onClick={stopRecording}
                    sx={styles.stopBtn}
                  >
                    Stop
                  </Button>
                )}

                {audioBlob && !isRecording && (
                  <Button
                    variant="contained"
                    onClick={() => setSubmitted(true)}
                    sx={styles.finishBtn}
                  >
                    Finish
                  </Button>
                )}
              </div>

              {/* Spacer (balances layout on wide screens) */}
              <div style={{ flex: "1 1 0", minWidth: 0 }} />
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
        /* ── Review / Submit view ── */
        <div style={styles.reviewWrapper}>
          <div style={styles.reviewCard}>
            {!sending ? (
              <>
                <h2 style={styles.reviewTitle}>Recorded Audio</h2>

                {audioURL && (
                  <audio controls src={audioURL} style={styles.reviewAudio} />
                )}

                <div style={styles.reviewBtnRow}>
                  <Button
                    variant="contained"
                    sx={styles.retryBtn}
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
                    sx={styles.submitBtn}
                    onClick={handleFinalSubmit}
                  >
                    Submit Attempt
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Alert severity="success" sx={{ mb: 3 }}>
                  Recording uploaded successfully!
                </Alert>

                <h3 style={{ margin: "0 0 4px" }}>{details.fullName}</h3>
                <p style={{ margin: "0 0 4px" }}>has completed</p>
                <strong>{story.title}</strong>

                <div>
                  <Button
                    variant="contained"
                    sx={styles.recordAgainBtn}
                    onClick={() => {
                      setAudioBlob(null);
                      setAudioURL(null);
                      setSubmitted(false);
                    }}
                  >
                    Record Again
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default StoryRecorder;

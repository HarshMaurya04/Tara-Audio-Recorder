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
import { createPortal } from "react-dom";
import { uploadAudioToBackend } from "../services/api";
import { getSenderFromBot, closeWebView } from "../services/botExtension";
import MicIcon from "@mui/icons-material/Mic";
import SettingsIcon from "@mui/icons-material/Settings";
import CloseIcon from "@mui/icons-material/Close";
import "../styles/StoryRecorder.mobile.css";

// Default audio recording configuration
const defaultMimeType = "audio/webm";
const defaultBitrate = 64000;
const maxRecordingTime = 60;

// Text auto-fit limits
const minFontSize = 18;
const maxFontSize = 30;

const exitFullscreen = () => {
  if (document.exitFullscreen) document.exitFullscreen();
  else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
  else if (document.msExitFullscreen) document.msExitFullscreen();
};

const isFullscreen = () =>
  document.fullscreenElement ||
  document.webkitFullscreenElement ||
  document.mozFullScreenElement ||
  document.msFullscreenElement;

// ─── Detect mobile (≤ 768px) ────────────────────────────────────────────────
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 768px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
};

// ─── Mobile mic dialog rendered via portal so it rotates with the layout ────
const MobileMicDialog = ({ open, onClose, children }) => {
  if (!open) return null;
  return createPortal(
    <>
      {/* Backdrop */}
      <div className="sr-mobile-dialog-backdrop" onClick={onClose} />
      {/* Rotated portal wrapper */}
      <div className="sr-mobile-dialog-portal">
        <div className="sr-mobile-dialog-inner">
          <div className="sr-mobile-dialog-box">
            {children}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
};

const StoryRecorder = ({ details = {} }) => {
  const formatTime = useCallback(
    (s) =>
      `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`,
    [],
  );

  const isMobile = useIsMobile();

  const [story, setStory] = useState(null);
  const [sender, setSender] = useState(null);

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

  useEffect(() => {
    const loadPayload = async () => {
      try {
        const payload = await getSenderFromBot();
        if (!payload || !payload.story) return;
        setSender(payload.user);
        setStory({
          title: payload.story.story_name,
          grade: payload.story.grade,
          lang: payload.story.language,
          text: payload.story.text,
          reference_text_id: payload.story.reference_text_id,
          para_no: payload.story.para_no,
        });
      } catch (err) {
        console.error("Failed to load story payload", err);
      }
    };
    loadPayload();
  }, []);

  const fitTextToContainer = useCallback(() => {
    if (!storyContainerRef.current || !measureRef.current || !story?.text)
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
  }, [story]);

  useEffect(() => {
    requestAnimationFrame(() => fitTextToContainer());
    window.addEventListener("resize", fitTextToContainer);
    return () => window.removeEventListener("resize", fitTextToContainer);
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
      if (audioContextRef.current.state !== "closed")
        audioContextRef.current.close();
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
      if (mediaRecorderRef.current.state !== "inactive")
        mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    setTimer(0);
  };

  const loadInputDevices = useCallback(async () => {
    setInputDevicesLoading(true);
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((d) => d.kind === "audioinput");
    const filtered = audioInputs.filter((device) => {
      const label = device.label?.trim();
      if (!label) return false;
      const lowerLabel = label.toLowerCase();
      return !(
        lowerLabel.includes("virtual") ||
        lowerLabel.includes("stereo mix") ||
        lowerLabel.includes("default") ||
        lowerLabel.includes("communications device") ||
        lowerLabel.includes("communications")
      );
    });
    const uniqueDevices = [];
    filtered.forEach((device) => {
      if (!uniqueDevices.some((d) => d.label === device.label))
        uniqueDevices.push(device);
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
      alert("Previously selected microphone is no longer available. Switching to the default microphone.");
      const fallbackId = uniqueDevices[0]?.deviceId;
      if (fallbackId) setSelectedDeviceId(fallbackId);
    } else if (!savedDeviceId && uniqueDevices.length > 0) {
      setSelectedDeviceId((prev) => {
        const stillValid = uniqueDevices.some((d) => d.deviceId === prev);
        if (!stillValid) {
          if (prev !== null)
            alert("Selected microphone is no longer available. Switching to a default microphone.");
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
    return () => cleanupRecording();
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
          alert("Microphone access was denied. Please allow microphone permission in your browser settings.");
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
      if (!analyserRef.current || !dataArrayRef.current || !canvasRef.current) return;
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
      const options = { mimeType: defaultMimeType, audioBitsPerSecond: defaultBitrate };
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

      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
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
        const blob = new Blob(audioChunksRef.current, { type: options.mimeType });
        setAudioBlob(blob);
        setAudioURL(URL.createObjectURL(blob));
        if (isMountedRef.current) setStopping(false);
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

  const closeMicModal = () => setMicModalOpen(false);

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;
    const handleDeviceChange = async () => await loadInputDevices();
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () =>
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
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
      if (document.hidden) stopRecording();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isRecording, stopRecording]);

  useEffect(() => {
    if (!audioBlob) setShowText(true);
  }, [audioBlob]);

  const handleFinalSubmit = async () => {
    if (!audioBlob) {
      alert("No audio recorded");
      return;
    }
    setSending(true);
    try {
      if (sender) {
        uploadAudioToBackend(audioBlob, sender, story);
      } else {
        console.warn("Sender not found in payload");
      }
    } catch (err) {
      console.error("Upload error:", err);
    }
  };

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (!story) {
    return (
      <div style={{ textAlign: "center", marginTop: 100 }}>
        <CircularProgress />
        <p>Loading story...</p>
      </div>
    );
  }

  // ─── Mic dialog content (shared between mobile custom dialog & desktop MUI dialog) ──
  const MicDialogContent = (
    <>
      {!recorderSupported ? (
        <Alert severity="error">Your browser does not support audio recording.</Alert>
      ) : !permissionGranted ? (
        <>
          <Alert severity="error" style={{ marginBottom: "1rem" }}>
            Please grant microphone access to use this feature.
          </Alert>
          <Button variant="contained" color="primary" onClick={requestMicPermission}>
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
          <Button variant="contained" color="warning" size="small" onClick={loadInputDevices}>
            Retry
          </Button>
        </>
      ) : (
        <FormControl fullWidth size="small">
          <InputLabel id="mic-selector-label">Select Microphone</InputLabel>
          <Select
            labelId="mic-selector-label"
            aria-label="Select a microphone input"
            inputProps={{ "aria-label": "Microphone device selector" }}
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
    </>
  );

  // ─── Shared: Hidden measurer div ─────────────────────────────────────────
  const HiddenMeasurer = (
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
  );

  // ─── Shared: Start / Stop button ─────────────────────────────────────────
  const RecordButton = !isRecording ? (
    <Button
      variant="contained"
      onClick={startRecording}
      disabled={initializing || stopping || isRecording || audioBlob}
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
        <CircularProgress size={20} sx={{ color: "#fff", display: "block" }} />
      ) : (
        "Start"
      )}
    </Button>
  ) : (
    <Button
      variant="contained"
      onClick={stopRecording}
      sx={{
        backgroundColor: "#ef5350",
        borderRadius: "30px",
        textTransform: "none",
        fontWeight: "600",
        color: "#fff",
        boxShadow: "0 4px 10px rgba(239, 83, 80, 0.3)",
        transition: "all 0.2s ease-in-out",
        "&:hover": {
          backgroundColor: "#d32f2f",
          boxShadow: "0 6px 14px rgba(211, 47, 47, 0.35)",
          transform: "scale(1.03)",
        },
      }}
    >
      Stop
    </Button>
  );

  const FinishButton = audioBlob && !isRecording && (
    <Button
      variant="contained"
      onClick={() => setSubmitted(true)}
      sx={{
        backgroundColor: "#4caf50",
        borderRadius: "30px",
        textTransform: "none",
        fontWeight: "600",
        boxShadow: "0 4px 12px rgba(76,175,80,0.3)",
        "&:hover": { backgroundColor: "#43a047" },
      }}
    >
      Finish
    </Button>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // MOBILE VIEW
  // ══════════════════════════════════════════════════════════════════════════
  if (isMobile) {
    // ── Mobile mic dialog: custom portal-based dialog that rotates with the layout ──
    const MobileMicDialogJSX = (
      <MobileMicDialog open={micModalOpen} onClose={closeMicModal}>
        {/* Title */}
        <div className="sr-mobile-dialog-title">
          <span>Microphone Settings</span>
          <IconButton
            aria-label="Close Dialog"
            size="small"
            onClick={closeMicModal}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </div>
        {/* Content */}
        <div className="sr-mobile-dialog-content">
          {MicDialogContent}
        </div>
        {/* Actions */}
        <div className="sr-mobile-dialog-actions">
          <Button variant="contained" onClick={closeMicModal} autoFocus>
            Done
          </Button>
        </div>
      </MobileMicDialog>
    );

    // Mobile — Review / Submission screen
    if (submitted) {
      return (
        <div className="sr-mobile-review-root">
          {MobileMicDialogJSX}
          <div className="sr-mobile-review-landscape-wrapper">
            <div className="sr-mobile-review-card">
              {!sending ? (
                <>
                  <h2 style={{ marginBottom: 20 }}>Recorded Audio</h2>
                  {audioURL && (
                    <audio controls src={audioURL} className="sr-mobile-review-audio" />
                  )}
                  <div className="sr-mobile-review-btn-row">
                    <Button
                      variant="contained"
                      sx={{ backgroundColor: "#ef5350", borderRadius: "30px", textTransform: "none" }}
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
                      sx={{ backgroundColor: "#1976d2", borderRadius: "30px", textTransform: "none" }}
                      onClick={handleFinalSubmit}
                    >
                      Submit Attempt
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Alert severity="success" sx={{ mb: 2, textAlign: "center", justifyContent: "center" }}>
                    Recording uploaded successfully!
                  </Alert>
                  <p>You have completed</p>
                  <strong>{story.title}</strong>
                  <p style={{ marginTop: 14 }}>What would you like to do next?</p>
                  <div className="sr-mobile-review-btn-row">
                    <Button
                      variant="contained"
                      sx={{ backgroundColor: "#4caf50", borderRadius: "30px", textTransform: "none" }}
                      onClick={() => {
                        setAudioBlob(null);
                        setAudioURL(null);
                        setSubmitted(false);
                        setSending(false);
                      }}
                    >
                      Record Again
                    </Button>
                    <Button
                      variant="contained"
                      sx={{ backgroundColor: "#1976d2", borderRadius: "30px", textTransform: "none" }}
                      onClick={() => closeWebView()}
                    >
                      Back to Chat
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Mobile — Recording screen
    return (
      <>
        {MobileMicDialogJSX}
        <div className="sr-mobile-root">
          <div className="sr-mobile-landscape-wrapper">
            <div className="sr-mobile-card">

              {/* Header */}
              <div className="sr-mobile-header">
                <span className="sr-mobile-header-meta">
                  Class: {story.grade} | {story.lang === "EN" ? "English" : "Hindi"}
                </span>
                <span className="sr-mobile-header-title">
                  {story.title || "Untitled Story"}
                </span>
                <div className="sr-mobile-header-actions">
                  <IconButton
                    aria-label="Open microphone settings"
                    size="small"
                    color="info"
                    onClick={() => setMicModalOpen(true)}
                    title="Microphone Settings"
                    sx={{ padding: "0 4px" }}
                  >
                    <SettingsIcon fontSize="small" />
                  </IconButton>
                </div>
              </div>

              {/* Body: Story text (left) | Controls (right) */}
              <div className="sr-mobile-body">
                <div
                  ref={storyContainerRef}
                  className={`sr-mobile-story-box${story.lang !== "EN" ? " font-devanagari" : ""}`}
                >
                  {showText && (
                    <p
                      className="sr-mobile-story-text"
                      style={{ fontSize: dynamicFontSize }}
                    >
                      {story.text || "Your story paragraph here"}
                    </p>
                  )}
                </div>

                <div className="sr-mobile-controls">
                  <span className="sr-mobile-timer" aria-live="polite" aria-atomic="true">
                    {formatTime(timer)}
                  </span>
                  <canvas
                    ref={canvasRef}
                    width={110}
                    height={34}
                    className="sr-mobile-canvas"
                    aria-hidden="true"
                  />
                  <div className="sr-mobile-btn-row">
                    {RecordButton}
                    {FinishButton}
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
        {HiddenMeasurer}
      </>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DESKTOP VIEW — original layout, unchanged
  // ══════════════════════════════════════════════════════════════════════════

  // Desktop uses the original MUI Dialog
  const DesktopMicModal = (
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
      <DialogContent dividers>
        {MicDialogContent}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={closeMicModal} autoFocus>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );

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
              padding: "30px 60px",
              boxShadow: "0 15px 40px rgba(0,0,0,0.08)",
              display: "flex",
              flexDirection: "column",
              gap: "20px",
            }}
          >
            {DesktopMicModal}

            {/* Top Info Row */}
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
                <div
                  style={{
                    fontSize: 14,
                    color: "#666",
                    display: "flex",
                    alignItems: "center",
                    flex: 1,
                    justifyContent: "flex-start",
                  }}
                >
                  <p>
                    Class: {story.grade} | Language:{" "}
                    {story.lang === "EN" ? "English" : "Hindi"}
                  </p>
                </div>
                <span style={{ fontWeight: "600", fontSize: 18 }}>
                  {story.title || "Untitled Story"}
                </span>
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
                boxShadow: "0 4px 8px rgba(0,0,0,0.05), 0 15px 35px rgba(0,0,0,0.08)",
                padding: "50px 40px",
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
            <div style={{ display: "flex", alignItems: "center", marginTop: 20 }}>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "1rem" }}>
                <span style={{ fontSize: 16, width: 50 }} aria-live="polite" aria-atomic="true">
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

              <div style={{ flex: 1, textAlign: "center" }}>
                {RecordButton}
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
                      "&:hover": { backgroundColor: "#43a047" },
                    }}
                  >
                    Finish
                  </Button>
                )}
              </div>

              <div style={{ flex: 1 }} />
            </div>
          </div>
          {HiddenMeasurer}
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
            {DesktopMicModal}
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
                <div style={{ display: "flex", justifyContent: "center", gap: "20px", marginTop: "30px" }}>
                  <Button
                    variant="contained"
                    sx={{ backgroundColor: "#ef5350", borderRadius: "30px", textTransform: "none" }}
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
                    sx={{ backgroundColor: "#1976d2", borderRadius: "30px", textTransform: "none" }}
                    onClick={handleFinalSubmit}
                  >
                    Submit Attempt
                  </Button>
                </div>
              </>
            ) : (
              <div style={{ textAlign: "center" }}>
                <Alert
                  severity="success"
                  sx={{ mb: 3, textAlign: "center", justifyContent: "center", maxWidth: "300px", margin: "0 auto" }}
                >
                  Recording uploaded successfully!
                </Alert>
                <p>You have completed</p>
                <strong>{story.title}</strong>
                <p style={{ marginTop: 20 }}>What would you like to do next?</p>
                <div style={{ display: "flex", justifyContent: "center", gap: "16px", marginTop: "20px", flexWrap: "wrap" }}>
                  <Button
                    variant="contained"
                    sx={{ backgroundColor: "#4caf50", borderRadius: "30px", textTransform: "none" }}
                    onClick={() => {
                      setAudioBlob(null);
                      setAudioURL(null);
                      setSubmitted(false);
                      setSending(false);
                    }}
                  >
                    Record Again
                  </Button>
                  <Button
                    variant="contained"
                    sx={{ backgroundColor: "#1976d2", borderRadius: "30px", textTransform: "none" }}
                    onClick={() => closeWebView()}
                  >
                    Back to Chat
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default StoryRecorder;
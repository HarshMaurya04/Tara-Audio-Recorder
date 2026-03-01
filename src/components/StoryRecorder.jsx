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
  Box,
  Typography,
  Paper,
  useMediaQuery,
  useTheme,
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

const defaultMimeType = "audio/webm";
const defaultBitrate = 64000;
const maxRecordingTime = 60;
const minFontSize = 14;
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

const StoryRecorder = ({ details = {} }) => {
  const story = STORY_DATA;
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

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

  const [dynamicFontSize, setDynamicFontSize] = useState(24);

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
      streamRef.current.getTracks().forEach((t) => t.stop());
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
    const filtered = audioInputs.filter((d) => {
      const label = d.label?.trim();
      if (!label) return false;
      const lower = d.label.toLowerCase();
      if (
        lower.includes("virtual") ||
        lower.includes("stereo mix") ||
        lower.includes("default") ||
        lower.includes("communications device") ||
        lower.includes("communications")
      )
        return false;
      return true;
    });
    const uniqueDevices = [];
    filtered.forEach((d) => {
      if (!uniqueDevices.some((u) => u.label === d.label))
        uniqueDevices.push(d);
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
          if (prev !== null)
            alert(
              "Selected microphone is no longer available. Switching to a default microphone.",
            );
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
      stream.getTracks().forEach((t) => t.stop());
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
        stream.getTracks().forEach((t) => t.stop());
        const hasDevices = await loadInputDevices();
        setPermissionGranted(hasDevices);
      })
      .catch((e) => {
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

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;
    const handleDeviceChange = async () => {
      await loadInputDevices();
    };
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () =>
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange,
      );
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

  const waitForBotExtension = () =>
    new Promise((resolve, reject) => {
      let attempts = 0;
      const interval = setInterval(() => {
        if (window.BotExtension?.getPayload) {
          clearInterval(interval);
          resolve(window.BotExtension);
        }
        if (++attempts > 50) {
          clearInterval(interval);
          reject("BotExtension SDK not loaded");
        }
      }, 100);
    });

  const handleFinalSubmit = async () => {
    if (!audioBlob) {
      alert("No audio recorded");
      return;
    }
    setSending(true);
    try {
      const sdk = await waitForBotExtension();
      sdk.getPayload(async (payload) => {
        if (!payload?.value) {
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

  // ── Mic Permission Modal ─────────────────────────────────────────
  const MicModal = (
    <Dialog
      open={micModalOpen}
      onClose={() => setMicModalOpen(false)}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        <b>Microphone Settings</b>
        <IconButton
          onClick={() => setMicModalOpen(false)}
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {!recorderSupported ? (
          <Alert severity="error">
            Your browser does not support audio recording.
          </Alert>
        ) : !permissionGranted ? (
          <>
            <Alert severity="error" sx={{ mb: 2 }}>
              Please grant microphone access to use this feature.
            </Alert>
            <Button variant="contained" onClick={requestMicPermission}>
              Enable Microphone
            </Button>
          </>
        ) : inputDevicesLoading ? (
          <Alert severity="info">Detecting microphones...</Alert>
        ) : inputDevices.length === 0 ? (
          <>
            <Alert severity="warning" sx={{ mb: 2 }}>
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
            <InputLabel id="mic-selector-label">Select Microphone</InputLabel>
            <Select
              labelId="mic-selector-label"
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
              {inputDevices.map((d) => (
                <MenuItem key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          variant="contained"
          onClick={() => setMicModalOpen(false)}
          autoFocus
        >
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );

  // ── Recording View ───────────────────────────────────────────────
  if (!submitted) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          background: "#f4f6f9",
          p: isMobile ? 1.5 : "20px",
          boxSizing: "border-box",
        }}
      >
        {MicModal}

        <Paper
          elevation={3}
          sx={{
            width: "100%",
            maxWidth: 850,
            borderRadius: isMobile ? "16px" : "24px",
            p: isMobile ? "20px 16px" : "40px 80px",
            display: "flex",
            flexDirection: "column",
            gap: isMobile ? "16px" : "30px",
          }}
        >
          {/* ── Header row ── */}
          <Box
            sx={{
              display: "flex",
              flexDirection: isMobile ? "column" : "row",
              justifyContent: "space-between",
              alignItems: isMobile ? "flex-start" : "center",
              pb: 1.5,
              borderBottom: "1px solid #eee",
              gap: isMobile ? 0.5 : 1.5,
            }}
          >
            {/* Student details */}
            <Box
              sx={{
                display: "flex",
                flexDirection: isMobile ? "column" : "row",
                gap: isMobile ? 0.3 : 2,
                flex: 1,
              }}
            >
              <Typography
                sx={{
                  color: "#7ed46a",
                  fontWeight: 600,
                  fontSize: isMobile ? 13 : 14,
                }}
              >
                {details.fullName}
              </Typography>
              <Typography sx={{ color: "#666", fontSize: isMobile ? 12 : 14 }}>
                Class: {details.std} | Section: {details.divn} | Roll No:{" "}
                {details.rollNo}
              </Typography>
            </Box>

            {/* Story title + mic settings */}
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: isMobile ? "space-between" : "center",
                gap: 1,
                width: isMobile ? "100%" : "auto",
                mt: isMobile ? 0.5 : 0,
              }}
            >
              <Typography
                sx={{
                  fontWeight: "bold",
                  fontSize: isMobile ? 14 : 16,
                  color: "#333",
                }}
              >
                {story.title || "Untitled Story"}
              </Typography>
              <IconButton
                size="small"
                color="info"
                onClick={() => setMicModalOpen(true)}
                title="Microphone Settings"
              >
                <SettingsIcon fontSize={isMobile ? "small" : "medium"} />
              </IconButton>
            </Box>
          </Box>

          {/* ── Story box ── */}
          <Box
            ref={storyContainerRef}
            className={story.lang !== "EN" ? "font-devanagari" : undefined}
            sx={{
              backgroundColor: "#ffffff",
              height: isMobile ? "200px" : "300px",
              borderRadius: isMobile ? "12px" : "20px",
              border: "3px solid #2f80ed",
              boxShadow:
                "0 4px 8px rgba(0,0,0,0.05), 0 15px 35px rgba(0,0,0,0.08)",
              p: isMobile ? "20px 16px" : "50px 60px",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              textAlign: "center",
              overflow: "hidden",
            }}
          >
            {showText && (
              <Typography
                sx={{
                  fontSize: dynamicFontSize,
                  m: 0,
                  color: "#7a7a7a",
                  fontWeight: 500,
                  lineHeight: 1.6,
                }}
              >
                {story.text || "Your story paragraph here"}
              </Typography>
            )}
          </Box>

          {/* ── Controls ── */}
          <Box
            sx={{
              display: "flex",
              flexDirection: isMobile ? "column" : "row",
              alignItems: isMobile ? "stretch" : "center",
              gap: isMobile ? 1.5 : 0,
            }}
          >
            {/* Timer + waveform */}
            <Box
              sx={{
                flex: isMobile ? "unset" : 1,
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                justifyContent: isMobile ? "center" : "flex-start",
              }}
            >
              <Typography
                component="span"
                sx={{
                  fontSize: 16,
                  width: 50,
                  fontVariantNumeric: "tabular-nums",
                }}
                aria-live="polite"
                aria-atomic="true"
              >
                {formatTime(timer)}
              </Typography>
              <canvas
                ref={canvasRef}
                width={isMobile ? 160 : 200}
                height={40}
                style={{
                  background: "linear-gradient(to bottom, #fff, #f1f1f1)",
                  borderRadius: 4,
                  border: "1px solid #ddd",
                  maxWidth: "100%",
                }}
                aria-hidden="true"
              />
            </Box>

            {/* Start / Stop / Finish buttons */}
            <Box
              sx={{
                flex: isMobile ? "unset" : 1,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: 2,
              }}
            >
              {!isRecording ? (
                <Button
                  variant="contained"
                  onClick={startRecording}
                  disabled={
                    initializing || stopping || isRecording || !!audioBlob
                  }
                  fullWidth={isMobile}
                  sx={{
                    backgroundColor: "#007bff",
                    borderRadius: "30px",
                    textTransform: "none",
                    fontWeight: 600,
                    px: 4,
                    boxShadow: "0 4px 10px rgba(0,119,255,0.3)",
                    "&:hover": {
                      backgroundColor: "#0066dd",
                      boxShadow: "0 6px 14px rgba(0,102,221,0.35)",
                      transform: "scale(1.03)",
                    },
                  }}
                >
                  {initializing ? (
                    <CircularProgress size={20} sx={{ color: "#fff" }} />
                  ) : (
                    "Start"
                  )}
                </Button>
              ) : (
                <Button
                  variant="contained"
                  onClick={stopRecording}
                  fullWidth={isMobile}
                  sx={{
                    backgroundColor: "#ef5350",
                    borderRadius: "30px",
                    textTransform: "none",
                    fontWeight: 600,
                    px: 4,
                    boxShadow: "0 4px 10px rgba(239,83,80,0.3)",
                    "&:hover": {
                      backgroundColor: "#d32f2f",
                      boxShadow: "0 6px 14px rgba(211,47,47,0.35)",
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
                  fullWidth={isMobile}
                  sx={{
                    backgroundColor: "#4caf50",
                    borderRadius: "30px",
                    textTransform: "none",
                    fontWeight: 600,
                    px: 4,
                    boxShadow: "0 4px 12px rgba(76,175,80,0.3)",
                    "&:hover": { backgroundColor: "#43a047" },
                  }}
                >
                  Finish
                </Button>
              )}
            </Box>

            {/* Spacer for desktop symmetry */}
            {!isMobile && <Box sx={{ flex: 1 }} />}
          </Box>
        </Paper>

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
      </Box>
    );
  }

  // ── Review / Submit View ─────────────────────────────────────────
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "#f4f6f9",
        p: isMobile ? 2 : "20px",
        boxSizing: "border-box",
      }}
    >
      <Paper
        elevation={3}
        sx={{
          width: "100%",
          maxWidth: isMobile ? "100%" : "400px",
          p: isMobile ? "32px 20px" : "48px 40px",
          borderRadius: isMobile ? "16px" : "28px",
          textAlign: "center",
        }}
      >
        {!sending ? (
          <>
            <Typography variant="h6" sx={{ mb: 4, fontWeight: 700 }}>
              Recorded Audio
            </Typography>

            {audioURL && (
              <audio
                controls
                src={audioURL}
                style={{ width: "100%", marginBottom: 8 }}
              />
            )}

            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                gap: 2,
                mt: 3,
                flexWrap: "wrap",
              }}
            >
              <Button
                variant="contained"
                fullWidth={isMobile}
                sx={{
                  backgroundColor: "#ef5350",
                  borderRadius: "30px",
                  textTransform: "none",
                  px: 3,
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
                fullWidth={isMobile}
                sx={{
                  backgroundColor: "#1976d2",
                  borderRadius: "30px",
                  textTransform: "none",
                  px: 3,
                }}
                onClick={handleFinalSubmit}
              >
                Submit Attempt
              </Button>
            </Box>
          </>
        ) : (
          <>
            <Alert severity="success" sx={{ mb: 3 }}>
              Recording uploaded successfully!
            </Alert>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {details.fullName}
            </Typography>
            <Typography sx={{ my: 1 }}>has completed</Typography>
            <Typography sx={{ fontWeight: 700 }}>{story.title}</Typography>
            <Button
              variant="contained"
              fullWidth={isMobile}
              sx={{ mt: 3, borderRadius: "30px", textTransform: "none", px: 3 }}
              onClick={() => {
                setAudioBlob(null);
                setAudioURL(null);
                setSubmitted(false);
              }}
            >
              Record Again
            </Button>
          </>
        )}
      </Paper>
    </Box>
  );
};

export default StoryRecorder;

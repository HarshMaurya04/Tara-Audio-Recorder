import { useState, useEffect, useRef } from "react";
import {
  Typography,
  IconButton,
  Paper,
  LinearProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  useMediaQuery,
  useTheme,
  CircularProgress,
  Alert,
} from "@mui/material";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { Slider } from "@mui/material";

// ─── CONFIG ────────────────────────────────────────────────────
const API_ENDPOINT =
  "https://i42u5elhm7.execute-api.ap-south-1.amazonaws.com/dev/webhook";

// ─── Helper: parse fileId from URL query params ─────────────────
function getFileIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("fileId");
}

// ─── Helper: map raw Lambda JSON → component report shape ───────
function mapApiResponseToReport(data) {
  const reportCard = data?.reportCard ?? {};
  const paraResults = reportCard?.paraResults ?? [];

  return {
    audioUrl: data?.audioUrl ?? null,
    storyTitle: data?.storyTitle ?? "Reading Assessment",
    overallScore: reportCard?.overallScore ?? 0,
    wcpm: reportCard?.wcpm ?? 0,
    accuracyScore: reportCard?.accuracyScore ?? 0,
    readingAccuracy:
      reportCard?.readingAccuracy != null
        ? Math.round(reportCard.readingAccuracy * 100)
        : 0,
    paceScore: reportCard?.paceScore ?? 0,
    pace: reportCard?.pace ?? "-",
    speechRate: reportCard?.speechRate ?? 0,
    phrasingScore: reportCard?.phrasingScore ?? 0,
    improperPhraseBreaks: reportCard?.improperPhraseBreaks ?? 0,
    missedPhraseBreaks: reportCard?.missedPhraseBreaks ?? 0,
    prominenceScore: reportCard?.prominenceScore ?? 0,
    paraResults: paraResults.map((para) => ({
      paraNo: para.paraNo,
      duration: para.duration ?? "00:00",
      wordFeedback: (para.wordFeedback ?? []).map((w) => ({
        promptWord: w.promptWord ?? "",
        decodedWord: w.decodedWord ?? "",
        miscueLabel: w.miscueLabel ?? "c",
        pbLabel: w.pbLabel ?? null,
      })),
    })),
  };
}

// ─── Score Badge ────────────────────────────────────────────────
function ScoreBadge({ label, value, compact = false }) {
  return (
    <div
      style={{
        backgroundColor: "#0288d1",
        color: "white",
        borderRadius: "8px",
        padding: compact ? "5px 8px" : "8px 12px",
        fontSize: compact ? "12px" : "14px",
        fontWeight: 500,
        display: "inline-flex",
        alignItems: "center",
        whiteSpace: "nowrap",
      }}
    >
      {label}: {value}
    </div>
  );
}

// ─── Mobile score card (2-column grid) ──────────────────────────
function MobileScoreGrid({ r }) {
  const scores = [
    { label: "Overall Score", value: r.overallScore },
    { label: "WCPM", value: r.wcpm },
    { label: "Accuracy (A)", value: r.accuracyScore },
    { label: "Reading Acc.", value: `${r.readingAccuracy}%` },
    { label: "Pace (P)", value: r.paceScore },
    { label: "Pace", value: `${r.pace} (${r.speechRate} syl/s)` },
    { label: "Phrasing (Ph)", value: r.phrasingScore },
    { label: "Improper Breaks", value: r.improperPhraseBreaks },
    { label: "Missed Breaks", value: r.missedPhraseBreaks },
    { label: "Prominence (P)", value: r.prominenceScore },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "6px",
      }}
    >
      {scores.map(({ label, value }) => (
        <ScoreBadge key={label} label={label} value={value} compact />
      ))}
    </div>
  );
}

// ─── Word Token ──────────────────────────────────────────────────
function WordToken({ feedback, isMobile }) {
  const { promptWord, decodedWord, miscueLabel, pbLabel } = feedback;
  const fontSize = isMobile ? "14px" : "16px";

  let wordStyle = { fontSize, color: "#1a8a1a" };
  let displayWord = promptWord;

  if (miscueLabel === "s") {
    wordStyle = { fontSize, color: "orange" };
  } else if (miscueLabel === "d") {
    wordStyle = { fontSize, textDecoration: "line-through", color: "#555" };
  } else if (miscueLabel === "i") {
    wordStyle = { fontSize, textDecoration: "underline", color: "#1a8a1a" };
    displayWord = decodedWord || promptWord;
  }

  const pbColorMap = { c: "#1a8a1a", i: "red", d: "orange" };
  const pbColor = pbLabel ? pbColorMap[pbLabel] : null;

  return (
    <>
      <Typography component="span" style={wordStyle}>
        {displayWord}{" "}
      </Typography>
      {pbColor && (
        <Typography component="span" style={{ fontSize, color: pbColor }}>
          ||{" "}
        </Typography>
      )}
    </>
  );
}

// ─── Audio Player ────────────────────────────────────────────────
function AudioPlayer({ audioUrl, isMobile }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const audioRef = useRef(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateProgress = () => {
      if (!audio.duration) return;

      const percent = (audio.currentTime / audio.duration) * 100;
      setProgress(percent);
      setCurrentTime(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDurationSec(audio.duration || 0);
    };

    const handleEnded = () => {
      setPlaying(false);
      setProgress(0);
      setCurrentTime(0);
    };

    audio.addEventListener("timeupdate", updateProgress);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("timeupdate", updateProgress);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
    };
  }, []);

  const togglePlay = () => {
    if (!audioUrl) return;

    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }

    setPlaying(!playing);
  };

  const formatTime = (seconds) => {
    if (!seconds) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flex: 1,
        backgroundColor: "white",
        borderRadius: "30px",
        padding: isMobile ? "4px 10px" : "6px 16px",
        boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
        minHeight: "36px",
      }}
    >
      <audio ref={audioRef} src={audioUrl} />

      <IconButton size="small" onClick={togglePlay} disabled={!audioUrl}>
        {playing ? (
          <PauseIcon style={{ fontSize: isMobile ? 18 : 20 }} />
        ) : (
          <PlayArrowIcon style={{ fontSize: isMobile ? 18 : 20 }} />
        )}
      </IconButton>

      <Typography variant="caption" style={{ minWidth: 80 }}>
        {formatTime(currentTime)} / {formatTime(durationSec)}
      </Typography>

      <div style={{ flex: 1, alignItems: "center" }}>
        <Slider
          value={progress}
          onChange={(e, newValue) => {
            const audio = audioRef.current;
            if (!audio || !audio.duration) return;

            const newTime = (newValue / 100) * audio.duration;
            audio.currentTime = newTime;
            setProgress(newValue);
          }}
          sx={{
            height: 4,
            padding: 0,
            "& .MuiSlider-thumb": {
              width: 12,
              height: 12,
            },
            "& .MuiSlider-rail": {
              opacity: 0.3,
            },
          }}
        />
      </div>

      <FiberManualRecordIcon style={{ fontSize: 8, color: "#4caf50" }} />
    </div>
  );
}

// ─── Legend Row ──────────────────────────────────────────────────
function LegendRow({ label, extraStyle = {} }) {
  return (
    <Typography
      style={{
        borderBottom: "1px solid #e0e0e0",
        padding: "6px 8px",
        textAlign: "center",
        fontSize: "13px",
        ...extraStyle,
      }}
    >
      {label}
    </Typography>
  );
}

// ─── Mobile Legend ───────────────────────────────────────────────
function MobileLegend() {
  const items = [
    { label: "Correct", extraStyle: { color: "#1a8a1a" } },
    { label: "Substitution", extraStyle: { color: "orange" } },
    {
      label: "Deletion",
      extraStyle: { textDecoration: "line-through", color: "#555" },
    },
    {
      label: "Insertion",
      extraStyle: { textDecoration: "underline", color: "#555" },
    },
    { label: "|| Correct", extraStyle: { color: "#1a8a1a" } },
    { label: "|| Improper", extraStyle: { color: "red" } },
    { label: "|| Missed", extraStyle: { color: "orange" } },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "6px",
        marginTop: "8px",
      }}
    >
      {items.map(({ label, extraStyle }) => (
        <div
          key={label}
          style={{
            border: "1px solid #e0e0e0",
            borderRadius: "20px",
            padding: "3px 10px",
            fontSize: "12px",
            backgroundColor: "#fafafa",
            ...extraStyle,
          }}
        >
          {label}
        </div>
      ))}
    </div>
  );
}

// ─── Loading State ───────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "16px",
        backgroundColor: "#e8eaf0",
      }}
    >
      <CircularProgress style={{ color: "#0288d1" }} />
      <Typography style={{ color: "#555", fontSize: 15 }}>
        Loading your report…
      </Typography>
    </div>
  );
}

// ─── Error State ─────────────────────────────────────────────────
function ErrorScreen({ message }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        backgroundColor: "#e8eaf0",
      }}
    >
      <Alert severity="error" style={{ maxWidth: 500 }}>
        {message}
      </Alert>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────
export default function StudentReport() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const prev = {
      body: document.body.style.overflow,
      html: document.documentElement.style.overflow,
    };
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev.body;
      document.documentElement.style.overflow = prev.html;
    };
  }, []);

  // ── Fetch report from Lambda ──────────────────────────────────
  useEffect(() => {
    async function fetchReport() {
      const fileId = getFileIdFromUrl();

      if (!fileId) {
        setError(
          "No fileId found in URL. Please open this page via the bot link.",
        );
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(
          `${API_ENDPOINT}?fileId=${encodeURIComponent(fileId)}`,
        );

        if (!res.ok) {
          throw new Error(`Failed to fetch report (status ${res.status})`);
        }

        const data = await res.json();
        console.log("Lambda response:", data);
        setReport(mapApiResponseToReport(data));
      } catch (err) {
        console.error("Report fetch error:", err);
        setError(
          "Could not load your report. Please try again or contact support.",
        );
      } finally {
        setLoading(false);
      }
    }

    fetchReport();
  }, []);

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} />;
  if (!report) return <ErrorScreen message="No report data available." />;

  const r = report;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "#e8eaf0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: isMobile ? "8px" : "24px",
      }}
    >
      <Paper
        elevation={3}
        style={{
          width: "100%",
          maxWidth: 1100,
          height: "100%",
          borderRadius: isMobile ? "12px" : "16px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "white",
        }}
      >
        {/* ── Scrollable inner ── */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: isMobile ? "8px 12px 16px" : "12px 20px 20px",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {/* Back button */}
          <IconButton
            style={{
              padding: 0,
              color: "#0288d1",
              marginBottom: isMobile ? "8px" : "16px",
            }}
          >
            <ArrowBackIosNewIcon style={{ fontSize: isMobile ? 22 : 26 }} />
          </IconButton>

          {/* ══ MOBILE LAYOUT ════════════════════════════════════ */}
          {isMobile ? (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <Typography style={{ fontWeight: 700, fontSize: 16 }}>
                Story Read: {r.storyTitle}
              </Typography>

              {/* Scores accordion */}
              <Accordion
                disableGutters
                elevation={0}
                defaultExpanded
                sx={{
                  backgroundColor: "#f1f3f9",
                  borderRadius: "12px !important",
                  "&:before": { display: "none" },
                }}
              >
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon />}
                  sx={{ minHeight: 44, px: 1.5 }}
                >
                  <Typography style={{ fontWeight: 600, fontSize: 14 }}>
                    📊 Scores Overview
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, px: 1.5, pb: 1.5 }}>
                  <MobileScoreGrid r={r} />
                </AccordionDetails>
              </Accordion>

              {/* Legend accordion */}
              <Accordion
                disableGutters
                elevation={0}
                sx={{
                  backgroundColor: "#f1f3f9",
                  borderRadius: "12px !important",
                  "&:before": { display: "none" },
                }}
              >
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon />}
                  sx={{ minHeight: 44, px: 1.5 }}
                >
                  <Typography style={{ fontWeight: 600, fontSize: 14 }}>
                    <InfoOutlinedIcon
                      style={{
                        fontSize: 16,
                        marginRight: "4px",
                        verticalAlign: "middle",
                      }}
                    />
                    Word Legend
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, px: 1.5, pb: 1.5 }}>
                  <MobileLegend />
                </AccordionDetails>
              </Accordion>

              {/* Paragraph cards */}
              {r.paraResults.map((para, index) => (
                <Paper
                  key={para.paraNo}
                  elevation={0}
                  style={{
                    backgroundColor: "#f1f3f9",
                    borderRadius: "12px",
                    padding: "12px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "10px",
                    }}
                  >
                    <Typography
                      style={{
                        fontWeight: 700,
                        fontSize: 15,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Para {index + 1}
                    </Typography>
                    <AudioPlayer audioUrl={r.audioUrl} isMobile />
                  </div>
                  <div style={{ lineHeight: 2.2 }}>
                    {para.wordFeedback.map((feedback, i) => (
                      <WordToken key={i} feedback={feedback} isMobile />
                    ))}
                  </div>
                </Paper>
              ))}
            </div>
          ) : (
            /* ══ DESKTOP LAYOUT ══════════════════════════════════ */
            <div
              style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}
            >
              {/* Main column */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <Paper
                  elevation={0}
                  style={{
                    backgroundColor: "#f1f3f9",
                    borderRadius: "12px",
                    padding: "16px",
                    marginBottom: "12px",
                  }}
                >
                  <Typography
                    style={{
                      fontWeight: 700,
                      fontSize: 18,
                      marginBottom: "12px",
                    }}
                  >
                    Story Read: {r.storyTitle}
                  </Typography>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      marginBottom: "8px",
                    }}
                  >
                    <ScoreBadge
                      label="Overall Score (A + P + Ph + Pr)"
                      value={r.overallScore}
                    />
                    <ScoreBadge label="WCPM" value={r.wcpm} />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      marginBottom: "8px",
                    }}
                  >
                    <ScoreBadge
                      label="Accuracy Score (A)"
                      value={r.accuracyScore}
                    />
                    <ScoreBadge
                      label="Reading Accuracy"
                      value={`${r.readingAccuracy}%`}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      marginBottom: "8px",
                    }}
                  >
                    <ScoreBadge label="Pace Score (P)" value={r.paceScore} />
                    <ScoreBadge
                      label="Pace"
                      value={`${r.pace} (${r.speechRate} syl/sec)`}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      marginBottom: "8px",
                    }}
                  >
                    <ScoreBadge
                      label="Phrasing Score (Ph)"
                      value={r.phrasingScore}
                    />
                    <ScoreBadge
                      label="Improper Phrase Breaks"
                      value={r.improperPhraseBreaks}
                    />
                    <ScoreBadge
                      label="Missed Phrase Breaks"
                      value={r.missedPhraseBreaks}
                    />
                  </div>
                  <div
                    style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}
                  >
                    <ScoreBadge
                      label="Prominence Score (P)"
                      value={r.prominenceScore}
                    />
                  </div>
                </Paper>

                {r.paraResults.map((para, index) => (
                  <Paper
                    key={para.paraNo}
                    elevation={0}
                    style={{
                      backgroundColor: "#f1f3f9",
                      borderRadius: "12px",
                      padding: "16px",
                      marginBottom: "12px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        marginBottom: "12px",
                      }}
                    >
                      <Typography
                        style={{
                          fontWeight: 700,
                          fontSize: 18,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Paragraph {index + 1}
                      </Typography>
                      <AudioPlayer audioUrl={r.audioUrl} />
                    </div>
                    <div style={{ lineHeight: 2 }}>
                      {para.wordFeedback.map((feedback, i) => (
                        <WordToken key={i} feedback={feedback} />
                      ))}
                    </div>
                  </Paper>
                ))}
              </div>

              {/* Sidebar */}
              <div
                style={{
                  width: "200px",
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                <Paper
                  elevation={0}
                  style={{
                    backgroundColor: "#f1f3f9",
                    borderRadius: "12px",
                    padding: "8px 12px",
                  }}
                >
                  <Typography style={{ fontWeight: 700 }}>
                    Attempt Summary :
                  </Typography>
                </Paper>
                <Paper
                  elevation={0}
                  style={{
                    backgroundColor: "#f1f3f9",
                    borderRadius: "12px",
                    padding: "12px",
                  }}
                >
                  <Typography
                    style={{
                      fontWeight: 700,
                      textAlign: "center",
                      marginBottom: "8px",
                    }}
                  >
                    Words Mistakes
                  </Typography>
                  <LegendRow
                    label="Correct"
                    extraStyle={{ color: "#1a8a1a" }}
                  />
                  <LegendRow
                    label="Substitution"
                    extraStyle={{ color: "orange" }}
                  />
                  <LegendRow
                    label="Deletion"
                    extraStyle={{
                      textDecoration: "line-through",
                      color: "#333",
                    }}
                  />
                  <LegendRow
                    label="Insertion"
                    extraStyle={{ textDecoration: "underline", color: "#333" }}
                  />
                  <Typography
                    style={{
                      fontWeight: 700,
                      textAlign: "center",
                      marginTop: "12px",
                      marginBottom: "8px",
                    }}
                  >
                    Phase Breaks ||
                  </Typography>
                  <LegendRow
                    label="|| - Correct"
                    extraStyle={{ color: "#1a8a1a" }}
                  />
                  <LegendRow
                    label="|| - Improper Breaks"
                    extraStyle={{ color: "red" }}
                  />
                  <LegendRow
                    label="|| - Missed Breaks"
                    extraStyle={{ color: "orange" }}
                  />
                </Paper>
              </div>
            </div>
          )}
        </div>
      </Paper>
    </div>
  );
}

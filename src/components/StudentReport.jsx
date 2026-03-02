import { useState, useEffect } from "react";
import {
  Box,
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

// ─── CONFIG ────────────────────────────────────────────────────
// Replace with your actual Lambda API Gateway endpoint
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
    <Box
      sx={{
        backgroundColor: "#0288d1",
        color: "white",
        borderRadius: "8px",
        px: compact ? 1 : 1.5,
        py: compact ? 0.6 : 1,
        fontSize: compact ? "12px" : "14px",
        fontWeight: 500,
        display: "inline-flex",
        alignItems: "center",
        whiteSpace: "nowrap",
      }}
    >
      {label}: {value}
    </Box>
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
    <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.8 }}>
      {scores.map(({ label, value }) => (
        <ScoreBadge key={label} label={label} value={value} compact />
      ))}
    </Box>
  );
}

// ─── Word Token ──────────────────────────────────────────────────
function WordToken({ feedback, isMobile }) {
  const { promptWord, decodedWord, miscueLabel, pbLabel } = feedback;
  const fontSize = isMobile ? "14px" : "16px";

  let wordSx = { fontSize, color: "#1a8a1a" };
  let displayWord = promptWord;

  if (miscueLabel === "s") {
    wordSx = { fontSize, color: "orange" };
  } else if (miscueLabel === "d") {
    wordSx = { fontSize, textDecoration: "line-through", color: "#555" };
  } else if (miscueLabel === "i") {
    wordSx = { fontSize, textDecoration: "underline", color: "#1a8a1a" };
    displayWord = decodedWord || promptWord;
  }

  const pbColorMap = { c: "#1a8a1a", i: "red", d: "orange" };
  const pbColor = pbLabel ? pbColorMap[pbLabel] : null;

  return (
    <>
      <Typography component="span" sx={wordSx}>
        {displayWord}{" "}
      </Typography>
      {pbColor && (
        <Typography component="span" sx={{ fontSize, color: pbColor }}>
          ||{" "}
        </Typography>
      )}
    </>
  );
}

// ─── Audio Player ────────────────────────────────────────────────
function AudioPlayer({ duration, isMobile }) {
  const [playing, setPlaying] = useState(false);

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        flex: 1,
        backgroundColor: "white",
        borderRadius: "30px",
        px: isMobile ? 1.2 : 2,
        py: 0.5,
        boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
        minWidth: 0,
      }}
    >
      <IconButton
        size="small"
        onClick={() => setPlaying(!playing)}
        sx={{ p: 0.4, flexShrink: 0 }}
      >
        {playing ? (
          <PauseIcon sx={{ fontSize: isMobile ? 18 : 20, color: "#333" }} />
        ) : (
          <PlayArrowIcon sx={{ fontSize: isMobile ? 18 : 20, color: "#333" }} />
        )}
      </IconButton>
      <Typography
        variant="caption"
        sx={{
          color: "#555",
          whiteSpace: "nowrap",
          fontSize: isMobile ? "11px" : "12px",
        }}
      >
        00:00/{duration}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <LinearProgress
          variant="determinate"
          value={0}
          sx={{
            height: 5,
            borderRadius: 4,
            backgroundColor: "#ddd",
            "& .MuiLinearProgress-bar": { backgroundColor: "#bbb" },
          }}
        />
      </Box>
      <FiberManualRecordIcon
        sx={{ fontSize: 10, color: "#4caf50", flexShrink: 0 }}
      />
    </Box>
  );
}

// ─── Legend Row ──────────────────────────────────────────────────
function LegendRow({ label, sx = {} }) {
  return (
    <Typography
      sx={{
        borderBottom: "1px solid #e0e0e0",
        px: 1,
        py: 0.75,
        textAlign: "center",
        fontSize: "13px",
        ...sx,
      }}
    >
      {label}
    </Typography>
  );
}

// ─── Mobile Legend (horizontal pill row) ─────────────────────────
function MobileLegend() {
  const items = [
    { label: "Correct", sx: { color: "#1a8a1a" } },
    { label: "Substitution", sx: { color: "orange" } },
    {
      label: "Deletion",
      sx: { textDecoration: "line-through", color: "#555" },
    },
    { label: "Insertion", sx: { textDecoration: "underline", color: "#555" } },
    { label: "|| Correct", sx: { color: "#1a8a1a" } },
    { label: "|| Improper", sx: { color: "red" } },
    { label: "|| Missed", sx: { color: "orange" } },
  ];

  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.8, mt: 1 }}>
      {items.map(({ label, sx }) => (
        <Box
          key={label}
          sx={{
            border: "1px solid #e0e0e0",
            borderRadius: "20px",
            px: 1.2,
            py: 0.4,
            fontSize: "12px",
            backgroundColor: "#fafafa",
            ...sx,
          }}
        >
          {label}
        </Box>
      ))}
    </Box>
  );
}

// ─── Loading State ───────────────────────────────────────────────
function LoadingScreen() {
  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        backgroundColor: "#e8eaf0",
      }}
    >
      <CircularProgress sx={{ color: "#0288d1" }} />
      <Typography sx={{ color: "#555", fontSize: 15 }}>
        Loading your report…
      </Typography>
    </Box>
  );
}

// ─── Error State ─────────────────────────────────────────────────
function ErrorScreen({ message }) {
  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 3,
        backgroundColor: "#e8eaf0",
      }}
    >
      <Alert severity="error" sx={{ maxWidth: 500 }}>
        {message}
      </Alert>
    </Box>
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
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        backgroundColor: "#e8eaf0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: isMobile ? 1 : 3,
      }}
    >
      <Paper
        elevation={3}
        sx={{
          width: "100%",
          maxWidth: 1100,
          height: "100%",
          borderRadius: isMobile ? 3 : 4,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "white",
        }}
      >
        {/* ── Scrollable inner ── */}
        <Box
          sx={{
            flex: 1,
            overflowY: "auto",
            px: isMobile ? 1.5 : 2.5,
            pt: isMobile ? 1 : 1.5,
            pb: isMobile ? 2 : 2.5,
            "&::-webkit-scrollbar": { display: "none" },
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {/* Back button */}
          <IconButton sx={{ p: 0, color: "#0288d1", mb: isMobile ? 1 : 2 }}>
            <ArrowBackIosNewIcon sx={{ fontSize: isMobile ? 22 : 26 }} />
          </IconButton>

          {/* ══ MOBILE LAYOUT ════════════════════════════════════ */}
          {isMobile ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Typography sx={{ fontWeight: 700, fontSize: 16 }}>
                Story Read: {r.storyTitle}
              </Typography>

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
                  <Typography sx={{ fontWeight: 600, fontSize: 14 }}>
                    📊 Scores Overview
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, px: 1.5, pb: 1.5 }}>
                  <MobileScoreGrid r={r} />
                </AccordionDetails>
              </Accordion>

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
                  <Typography sx={{ fontWeight: 600, fontSize: 14 }}>
                    <InfoOutlinedIcon
                      sx={{ fontSize: 16, mr: 0.5, verticalAlign: "middle" }}
                    />
                    Word Legend
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, px: 1.5, pb: 1.5 }}>
                  <MobileLegend />
                </AccordionDetails>
              </Accordion>

              {r.paraResults.map((para, index) => (
                <Paper
                  key={para.paraNo}
                  elevation={0}
                  sx={{ backgroundColor: "#f1f3f9", borderRadius: 3, p: 1.5 }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      mb: 1.2,
                    }}
                  >
                    <Typography
                      sx={{
                        fontWeight: 700,
                        fontSize: 15,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Para {index + 1}
                    </Typography>
                    <AudioPlayer
                      duration={`00:${(para.duration ?? "00:00").split(":")[1] ?? "00"}`}
                      isMobile
                    />
                  </Box>
                  <Box sx={{ lineHeight: 2.2 }}>
                    {para.wordFeedback.map((feedback, i) => (
                      <WordToken key={i} feedback={feedback} isMobile />
                    ))}
                  </Box>
                </Paper>
              ))}
            </Box>
          ) : (
            /* ══ DESKTOP LAYOUT ══════════════════════════════════ */
            <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start" }}>
              {/* Main column */}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Paper
                  elevation={0}
                  sx={{
                    backgroundColor: "#f1f3f9",
                    borderRadius: 3,
                    p: 2,
                    mb: 1.5,
                  }}
                >
                  <Typography sx={{ fontWeight: 700, fontSize: 18, mb: 1.5 }}>
                    Story Read: {r.storyTitle}
                  </Typography>
                  <Box
                    sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 1 }}
                  >
                    <ScoreBadge
                      label="Overall Score (A + P + Ph + Pr)"
                      value={r.overallScore}
                    />
                    <ScoreBadge label="WCPM" value={r.wcpm} />
                  </Box>
                  <Box
                    sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 1 }}
                  >
                    <ScoreBadge
                      label="Accuracy Score (A)"
                      value={r.accuracyScore}
                    />
                    <ScoreBadge
                      label="Reading Accuracy"
                      value={`${r.readingAccuracy}%`}
                    />
                  </Box>
                  <Box
                    sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 1 }}
                  >
                    <ScoreBadge label="Pace Score (P)" value={r.paceScore} />
                    <ScoreBadge
                      label="Pace"
                      value={`${r.pace} (${r.speechRate} syl/sec)`}
                    />
                  </Box>
                  <Box
                    sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 1 }}
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
                  </Box>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                    <ScoreBadge
                      label="Prominence Score (P)"
                      value={r.prominenceScore}
                    />
                  </Box>
                </Paper>

                {r.paraResults.map((para, index) => (
                  <Paper
                    key={para.paraNo}
                    elevation={0}
                    sx={{
                      backgroundColor: "#f1f3f9",
                      borderRadius: 3,
                      p: 2,
                      mb: 1.5,
                    }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1.5,
                        mb: 1.5,
                      }}
                    >
                      <Typography
                        sx={{
                          fontWeight: 700,
                          fontSize: 18,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Paragraph {index + 1}
                      </Typography>
                      <AudioPlayer
                        duration={`00:${(para.duration ?? "00:00").split(":")[1] ?? "00"}`}
                      />
                    </Box>
                    <Box sx={{ lineHeight: 2 }}>
                      {para.wordFeedback.map((feedback, i) => (
                        <WordToken key={i} feedback={feedback} />
                      ))}
                    </Box>
                  </Paper>
                ))}
              </Box>

              {/* Sidebar */}
              <Box
                sx={{
                  width: 200,
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <Paper
                  elevation={0}
                  sx={{
                    backgroundColor: "#f1f3f9",
                    borderRadius: 3,
                    px: 1.5,
                    py: 1,
                  }}
                >
                  <Typography sx={{ fontWeight: 700 }}>
                    Attempt Summary :
                  </Typography>
                </Paper>
                <Paper
                  elevation={0}
                  sx={{
                    backgroundColor: "#f1f3f9",
                    borderRadius: 3,
                    px: 1.5,
                    py: 1.5,
                  }}
                >
                  <Typography
                    sx={{ fontWeight: 700, textAlign: "center", mb: 1 }}
                  >
                    Words Mistakes
                  </Typography>
                  <LegendRow label="Correct" sx={{ color: "#1a8a1a" }} />
                  <LegendRow label="Substitution" sx={{ color: "orange" }} />
                  <LegendRow
                    label="Deletion"
                    sx={{ textDecoration: "line-through", color: "#333" }}
                  />
                  <LegendRow
                    label="Insertion"
                    sx={{ textDecoration: "underline", color: "#333" }}
                  />
                  <Typography
                    sx={{
                      fontWeight: 700,
                      textAlign: "center",
                      mt: 1.5,
                      mb: 1,
                    }}
                  >
                    Phase Breaks ||
                  </Typography>
                  <LegendRow label="|| - Correct" sx={{ color: "#1a8a1a" }} />
                  <LegendRow
                    label="|| - Improper Breaks"
                    sx={{ color: "red" }}
                  />
                  <LegendRow
                    label="|| - Missed Breaks"
                    sx={{ color: "orange" }}
                  />
                </Paper>
              </Box>
            </Box>
          )}
        </Box>
      </Paper>
    </Box>
  );
}

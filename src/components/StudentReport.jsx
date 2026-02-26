import React, { useEffect, useState } from "react";

function StudentReport() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  const fileId = "019c8e50-39ea-727e-9dc8-dd9b7acf9c81";

  useEffect(() => {
    async function fetchReport() {
      try {
        const response = await fetch(
          `https://i42u5elhm7.execute-api.ap-south-1.amazonaws.com/dev/webhook?fileId=${fileId}`,
        );

        if (!response.ok) {
          throw new Error("Failed to fetch report");
        }

        const data = await response.json();
        setReport(data);
      } catch (error) {
        console.error("Error fetching report:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchReport();
  }, []);

  if (loading) return <h2>Loading report...</h2>;
  if (!report) return <h2>No report found</h2>;

  const reportCard = report.reportCard;

  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
      <h2>📊 Reading Report</h2>

      <p>
        <strong>WCPM:</strong> {reportCard.wcpm}
      </p>
      <p>
        <strong>Accuracy:</strong> {reportCard.readingAccuracy * 100}%
      </p>
      <p>
        <strong>Overall Score:</strong> {reportCard.overallScore}
      </p>

      <hr />

      {reportCard.paraResults.map((para, index) => (
        <div key={index}>
          <h3>Paragraph {index + 1}</h3>

          <p>
            {para.wordFeedback.map((word, i) => {
              if (word.miscueLabel === "c")
                return (
                  <span key={i} style={{ color: "green" }}>
                    {word.decodedWord}{" "}
                  </span>
                );

              if (word.miscueLabel === "s")
                return (
                  <span key={i} style={{ color: "orange" }}>
                    {word.promptWord}{" "}
                  </span>
                );

              if (word.miscueLabel === "d")
                return (
                  <span key={i} style={{ textDecoration: "line-through" }}>
                    {word.promptWord}{" "}
                  </span>
                );

              if (word.miscueLabel === "i")
                return (
                  <span key={i} style={{ textDecoration: "underline" }}>
                    {word.decodedWord}{" "}
                  </span>
                );

              return <span key={i}>{word.promptWord} </span>;
            })}
          </p>
        </div>
      ))}
    </div>
  );
}

export default StudentReport;

export const uploadAudioToBackend = async (audioBlob, sender) => {
  const base64 = await blobToBase64(audioBlob);

  const response = await fetch(
    "https://i42u5elhm7.execute-api.ap-south-1.amazonaws.com/dev/webhook",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "webview",
        sender: sender,
        audio: base64,
        fileType: "webm",
      }),
    },
  );

  if (!response.ok) {
    throw new Error("Upload failed");
  }

  return response.json();
};

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = () => {
      resolve(reader.result.split(",")[1]);
    };
    reader.onerror = reject;
  });
export const getSenderFromBot = () => {
  return new Promise((resolve) => {
    if (window.BotExtension) {
      window.BotExtension.getPayload((data) => {
        resolve(data);
      });
    } else {
      resolve(null);
    }
  });
};

export const getReportPayload = () => {
  return new Promise((resolve) => {
    if (window.BotExtension) {
      window.BotExtension.getPayload((data) => {
        try {
          const parsed = JSON.parse(data?.value || "{}");
          resolve(parsed);
        } catch (e) {
          console.error("Payload parse error:", e);
          resolve(null);
        }
      });
    } else {
      resolve(null);
    }
  });
};

export const closeWebView = () => {
  if (window.BotExtension) {
    window.BotExtension.close();
  }
};

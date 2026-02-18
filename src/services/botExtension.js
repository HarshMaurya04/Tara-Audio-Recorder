export const getSenderFromBot = () => {
  return new Promise((resolve) => {
    if (window.BotExtension) {
      window.BotExtension.getPayload((data) => {
        console.log("Raw payload from SwiftChat:", data);

        // Handle both formats safely
        if (typeof data === "string") {
          resolve(data);
        } else if (data?.value) {
          resolve(data.value);
        } else {
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

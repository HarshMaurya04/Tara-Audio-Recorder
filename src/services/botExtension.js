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

export const closeWebView = () => {
  if (window.BotExtension) {
    window.BotExtension.close();
  }
};

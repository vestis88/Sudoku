# Setting up the shared leaderboard (Firebase)

The leaderboard syncs between devices through **Cloud Firestore** on Firebase's
free **Spark** plan (no credit card needed). Until it is set up, the
leaderboard only shows games played on the current device.

It takes about ten minutes.

## 1. Create a project

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. **Create a project**, for example `sudoku-kul`. Google Analytics is not
   needed, so you can turn it off.

## 2. Create the database

1. In the left menu choose **Build → Firestore Database → Create database**.
2. Pick a location in Europe (for example `eur3` or `europe-north1`). This
   can't be changed later.
3. Choose **Start in production mode**.

## 3. Add the security rules

1. Open the **Rules** tab of Firestore Database.
2. Replace everything with the contents of [`firestore.rules`](../firestore.rules)
   from this repository, then **Publish**.

The rules let anyone who opens the game read the leaderboard and add a result,
but only for Wille, Johan, Bim or Frans, with a sensible time. Results can
never be changed or deleted from the app. (You can still delete results by
hand in the Firebase console.)

## 4. Register the web app

1. Click the gear icon → **Project settings** → **General**.
2. Under **Your apps**, click the web icon **`</>`**, give it a nickname such as
   `Sudoku Kul` and click **Register app**. Firebase Hosting is not needed.
3. Firebase shows a `firebaseConfig` block. Copy the `apiKey` and
   `projectId` values.

## 5. Put the values in the app

Edit [`js/firebase-config.js`](../js/firebase-config.js):

```js
window.SUDOKU_FIREBASE = {
  apiKey: 'AIza…',
  projectId: 'sudoku-kul',
};
```

Commit and push to `main`; GitHub Pages redeploys automatically. The
leaderboard header then shows **☁️ Synkad** instead of
**📱 Bara den här enheten**.

These values are not secret. They only say which project to talk to, and
the security rules decide what is allowed.

## 6. Recommended: limit the key to your website

1. Open <https://console.cloud.google.com/apis/credentials> and select the
   same project.
2. Open the **Browser key (auto created by Firebase)**.
3. Under **Application restrictions** choose **Websites** and add
   `https://vestis88.github.io/*`.
4. Save.

Other websites can then no longer use the key.

## How syncing works

* Every finished game is saved on the device first, then uploaded.
* Without internet the result waits on the device (the leaderboard shows
  **📴 Offline – 1 väntar**) and is uploaded the next time the home screen
  is opened with a connection.
* The home screen downloads all results each time it is shown. The free plan
  allows 50,000 reads per day, and each stored result counts as one read per
  home screen visit, which is plenty for a family.

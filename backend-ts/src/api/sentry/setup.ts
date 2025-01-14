import axios from 'axios';
import express from 'express';

import SentryInstallation from '../../models/SentryInstallation.model';

export type TokenResponseData = {
  expiresAt: string; // ISO date string at which token must be refreshed
  token: string; // Bearer token authorized to make Sentry API requests
  refreshToken: string; // Refresh token required to get a new Bearer token after expiration
};

export type InstallResponseData = {
  app: {
    uuid: string; // UUID for your application (shared across installations)
    slug: string; // URL slug for your application (shared across installations)
  };
  organization: {
    slug: string; // URL slug for the organization doing the installation
  };
  uuid: string; // UUID for the individual installation
};

const router = express.Router();

router.post('/', async (req, res) => {
  console.log('Redirect URL - Setup');
  // Destructure the all the body params we receive from the installation prompt
  const {code, installationId, sentryOrgSlug} = req.body;
  if (!code || !installationId) {
    res.status(403).json({
      status: 'error',
      message: 'Invalid code or installationId',
    });
    return;
  }

  // Construct a payload to ask Sentry for a token on the basis that a user is installing
  const payload = {
    grant_type: 'authorization_code',
    code,
    client_id: process.env.SENTRY_CLIENT_ID,
    client_secret: process.env.SENTRY_CLIENT_SECRET,
  };

  // Send that payload to Sentry and parse its response
  const tokenResponse: {data: TokenResponseData} = await axios.post(
    `${process.env.SENTRY_URL}/api/0/sentry-app-installations/${installationId}/authorizations/`,
    payload
  );

  // Store the tokenData (i.e. token, refreshToken, expiresAt) for future requests
  //    - Make sure to associate the installationId and the tokenData since it's unique to the organization
  //    - Using the wrong token for the a different installation will result 401 Unauthorized responses
  const {token, refreshToken, expiresAt} = tokenResponse.data;
  console.log('Creating SentryInstallation');
  console.log(installationId, sentryOrgSlug, expiresAt, token, refreshToken);
  await SentryInstallation.create({
    uuid: installationId as string,
    orgSlug: sentryOrgSlug as string,
    expiresAt: new Date(expiresAt),
    token,
    refreshToken,
  });
  console.log('Created SentryInstallation');

  // Verify the installation to inform Sentry of the success
  //    - This step is only required if you have enabled 'Verify Installation' on your integration
  const verifyResponse: {data: InstallResponseData} = await axios.put(
    `${process.env.SENTRY_URL}/api/0/sentry-app-installations/${installationId}/`,
    {status: 'installed'},
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  // Continue the installation process
  // - If your app requires additional configuration, this is where you can do it
  // - The token/refreshToken can be used to make requests to Sentry's API
  // - Once you're done, you can optionally redirect the user back to Sentry as we do below
  console.info(`Installed ${verifyResponse.data.app.slug}'`);
  res.status(201).send({
    status: 'success',
    redirectUrl: `${process.env.SENTRY_URL}/settings/${sentryOrgSlug}/sentry-apps/${verifyResponse.data.app.slug}/`,
  });
});

export default router;

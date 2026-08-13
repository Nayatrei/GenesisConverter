const { defineConfig } = require('@playwright/test');
const port = process.env.PLAYWRIGHT_PORT || '4173';
const baseURL = `http://127.0.0.1:${port}`;

module.exports = defineConfig({
    testDir: './tests',
    timeout: 90_000,
    expect: {
        timeout: 20_000
    },
    use: {
        baseURL,
        viewport: { width: 1440, height: 1280 },
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    projects: [
        {
            name: 'chromium',
            use: {
                browserName: 'chromium'
            }
        }
    ],
    webServer: {
        command: `PORT=${port} node server.js`,
        url: `${baseURL}/3d-obj`,
        reuseExistingServer: true,
        timeout: 120_000
    }
});

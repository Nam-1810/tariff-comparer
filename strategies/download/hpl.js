const { downloadFileWithRetry } = require('../downloadUtils.js');
const playwright = require('playwright-core');
const common = require('../../common.js');

const countriesByContinent = {
    Asia: [
        "China", "Japan", "Korea", "India", "Vietnam", "Thailand", "Taiwan, China",
        "Singapore", "Australia", "Indonesia", "Malaysia", "Philippines",
        "Bangladesh", "Hong Kong SAR, China",
    ],
    NorthAmerica: ["United States", "Canada"],
    Europe: [
        "United kingdom", "Germany", "France", "Netherlands", "Belgium",
        "Spain", "Italy", "Poland", "Turkey"
    ],
};

class HPLDownloadStrategy {
    async download(config) {
        const cleanedLinks = await this.getLinksFromWebsite(config.hplUrl);
        const month = new Date().toISOString().slice(0, 7);
        common.updateStatus(`Month: ${month}\n`);
        if (Object.keys(cleanedLinks).length === 0) {
            common.updateStatus(`No valid links found to download.\n`);;
            return;
        }

        let totalFiles = 0;
        let downloadedFiles = 0;

        Object.values(cleanedLinks).forEach(urls => {
            totalFiles += urls.length;
        });
        common.updateStatus(`--------------------------------\n`);
        common.updateStatus(`Total files to download: ${totalFiles} \n`);

        const downloadPromises = [];
        common.updateStatus(`Starting downloads...\n`);
        Object.entries(cleanedLinks).forEach(([country, urls], index) => {

            urls.forEach((fileUrl, fileIndex) => {

                const urlParts = fileUrl.split('/');
                let originalFileName = urlParts[urlParts.length - 1].split('?')[0];
    
                if (!originalFileName || !originalFileName.endsWith('.pdf')) {
                    originalFileName = `tariff-${fileIndex + 1}.pdf`;
                }
                const fileName = `HPL/${month}/${country}/${originalFileName}`;
                const filePath = `${config.rootPath}/${fileName}`;
                const delay = (index * 1000) + (fileIndex * 300);

                const downloadTask = new Promise(resolve => {
                    setTimeout(async () => {
                        try {
                            const success = await downloadFileWithRetry(fileUrl, filePath, 3, 3000);
                            if (success) {
                                downloadedFiles++;
                            }
                        } catch (error) {
                            common.updateStatus(`Error in download task for ${filePath}: ${error.message}\n`);
                        } finally {
                            resolve();
                        }
                    }, delay);
                });

                downloadPromises.push(downloadTask);
            });
        });
        await Promise.all(downloadPromises);
        common.updateStatus(`All downloads completed.\n`);

        if (downloadedFiles === totalFiles) {
            common.updateStatus(`🎉 All ${totalFiles} files downloaded successfully!\n`);
        } else {
            common.updateStatus(`Downloaded ${downloadedFiles}/${totalFiles} files.\n`);
        }
    }


    async getLinksFromWebsite(tariffUrl) {
        try {

            const browser = await playwright.chromium.launch({
                headless: true,
                ...(common.chromiumPath && { executablePath: common.chromiumPath })
            });

            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
                extraHTTPHeaders: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Referer': 'https://www.hapag-lloyd.com/',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'same-origin',
                    'Sec-Fetch-User': '?1',
                },
            });

            const page = await context.newPage();

            await page.goto(tariffUrl, { waitUntil: 'networkidle', timeout: 60000 });


            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(1000);

            await page.mouse.move(100, 100);
            await page.mouse.click(100, 100);

            const links = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a[href$=".pdf"]')).map(a => ({
                    text: a.innerText.trim(),
                    href: a.href.trim(),
                }));
            });
            await browser.close();
            const filteredLinks = {};
            links.forEach(({ text, href }) => {
                const lowerText = text.toLowerCase();
                for (const [continent, countries] of Object.entries(countriesByContinent)) {
                    if (
                        countries.some(country => lowerText.includes(country.toLowerCase())) &&
                        (lowerText.includes('import'))
                    ) {
                        const matchedCountry = countries.find(country => lowerText.includes(country.toLowerCase()));
                        if (!filteredLinks[matchedCountry]) {
                            filteredLinks[matchedCountry] = new Set();
                        }
                        filteredLinks[matchedCountry].add(href);
                        break;
                    }
                }
            });

            const cleanedLinks = {};
            Object.keys(filteredLinks).forEach(country => {
                cleanedLinks[country] = [...filteredLinks[country]];
            });

            return cleanedLinks;

        } catch (error) {
            console.error(`Error fetching HTML: ${error.message}`);
            throw error;
        }
    }
}

module.exports = HPLDownloadStrategy;
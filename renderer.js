class TariffController {
  static carrier = 'CMA';

  static init() {
    const carrierSelect = document.getElementById('carrierSelect');
    carrierSelect.addEventListener('change', () => {
      this.carrier = carrierSelect.value;
    });

    const statusElement = document.getElementById('status');
    const changedList = document.getElementById('changedList');
    const unchangedList = document.getElementById('unchangedList');
    const missingList = document.getElementById('missingList');

    window.electronAPI.updateStatus((event, text) => {
      statusElement.textContent += `${text}\n`;
    });


    window.electronAPI.updateChangesTariffs((event, changedCountries) => {
      changedList.innerHTML = '';
      if (changedCountries.length === 0) {
        changedList.innerHTML = '<li>No countries with changes.</li>';
      } else {
        const li = document.createElement('li');
        const countryNames = changedCountries.map(item => item.country).join(', ');
        const countryData = JSON.stringify(changedCountries);
        li.innerHTML = `${countryNames} <button id="sendtoAI" data-countries='${countryData}'>Send to AI</button>`;
        changedList.appendChild(li);
      }
    });

    window.electronAPI.updateUnChangesTariffs((event, unChangedCountries) => {
      unchangedList.innerHTML = '';
      if (unChangedCountries.length === 0) {
        unchangedList.innerHTML = '<li>No countries without changes.</li>';
      } else {
        const li = document.createElement('li');
        li.textContent = unChangedCountries.join(', ');
        unchangedList.appendChild(li);
      }
    });

    window.electronAPI.updateMissingTariffs((event, missingCountries) => {
      missingList.innerHTML = '';
      if (missingCountries.length === 0) {
        missingList.innerHTML = '<li>No missing country files.</li>';
      } else {
        const li = document.createElement('li');
        const missingDetails = missingCountries.map(item => `${item.country} (missing in ${item.missingIn})`).join(', ');
        li.textContent = missingDetails;
        missingList.appendChild(li);
      }
    });

    document.getElementById('editConfigButton').addEventListener('click', () => {
      window.location.href = 'config.html';
    });

    document.getElementById('editFileConfigButton').addEventListener('click', () => {
      window.location.href = 'file-config.html';
    });

    document.getElementById('resultsButton').addEventListener('click', () => {
      window.location.href = 'results.html';
    });

    document.getElementById('downloadButton').addEventListener('click', this.processFiles.bind(this));

    document.getElementById('compareButton').addEventListener('click', this.compareFiles.bind(this));

    document.addEventListener('click', async (event) => {
      document.addEventListener('click', (event) => {
        if (event.target.id === 'sendtoAI') {
          this.handleSendToAI(event.target);
        }
      });
    });
  }

  static async handleSendToAI(button) {
    const statusElement = document.getElementById('status');
    if (!statusElement) {
      console.error('statusElement is null');
      return;
    }

    statusElement.textContent = 'Starting comparison...\n';
    this.toggleButtonsState(true);
    try {
      const config = await window.electronAPI.getConfig(['rootPath', 'model', 'apiKey']);
      const countriesData = JSON.parse(button.getAttribute('data-countries'));
      await window.electronAPI.sendToAIFunc(this.carrier, countriesData, config.apiKey, config.model);
      statusElement.textContent += 'Sent to AI successfully.\n';
    } catch (error) {
      statusElement.textContent += `Error: ${error.message}\n`;
    } finally {
      this.toggleButtonsState(false);
    }
  }

  static async processFiles() {
    const statusElement = document.getElementById('status');
    statusElement.textContent = `Processing files for ${this.carrier}...\n`;
    this.toggleButtonsState(true);
    try {
      const config = await window.electronAPI.getConfig(['rootPath', `${this.carrier.toLowerCase()}Url`]);
      await window.electronAPI.downloadFileFunc(this.carrier, config);

    } catch (error) {
      statusElement.textContent += `Error: ${error.message}\n`;
    } finally {
      this.toggleButtonsState(false);
    }
  }

  static async compareFiles() {

    const statusElement = document.getElementById('status');
    statusElement.textContent = `Comparing files for ${this.carrier}...\n`;

    try {
      const config = await window.electronAPI.getConfig(['rootPath']);
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonthNum = now.getMonth() + 1;
      const currentMonth = `${currentYear}-${currentMonthNum.toString().padStart(2, '0')}`;

      const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1);
      const previousYear = previousMonthDate.getFullYear();
      const previousMonthNum = previousMonthDate.getMonth() + 1;
      const previousMonth = `${previousYear}-${previousMonthNum.toString().padStart(2, '0')}`

      await window.electronAPI.compareFilesFunc(this.carrier, config.rootPath, currentMonth, previousMonth);
    } catch (error) {
      statusElement.textContent += `Error: ${error.message}\n`;
    }
  }

  static toggleButtonsState(value) {
    const carrierSelect = document.getElementById('carrierSelect');
    const downloadButton = document.getElementById('downloadButton');
    const compareButton = document.getElementById('compareButton');
    const resultsButton = document.getElementById('resultsButton');
    const editConfigButton = document.getElementById('editConfigButton');
    const editFileConfigButton = document.getElementById('editFileConfigButton');

    carrierSelect.disabled = value;
    downloadButton.disabled = value;
    compareButton.disabled = value;
    resultsButton.disabled = value;
    editConfigButton.disabled = value;
    editFileConfigButton.disabled = value;

  }
}
TariffController.init();
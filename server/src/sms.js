import { config } from './config.js';

/**
 * Envoi du code par SMS.
 * Fournisseurs branchables sans toucher au reste de l'API :
 *   - console : écrit le code dans les logs (développement)
 *   - termii  : agrégateur africain, simple et couvre la Côte d'Ivoire
 *   - twilio  : international
 */
export async function sendSms(phone, message) {
  switch (config.smsProvider) {
    case 'console':
      console.log(`\n📱 [SMS simulé] ${phone} : ${message}\n`);
      return { ok: true, provider: 'console' };

    case 'twilio': {
      const { sid, token, from } = config.twilio;
      if (!sid || !token || !from) throw new Error('Configuration Twilio incomplète');
      const body = new URLSearchParams({ To: phone, From: from, Body: message });
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body
        }
      );
      if (!res.ok) throw new Error(`Twilio ${res.status} : ${await res.text()}`);
      return { ok: true, provider: 'twilio' };
    }

    case 'termii': {
      const { key, from } = config.termii;
      if (!key) throw new Error('Configuration Termii incomplète');
      const res = await fetch('https://api.ng.termii.com/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: phone.replace('+', ''),
          from,
          sms: message,
          type: 'plain',
          channel: 'generic',
          api_key: key
        })
      });
      if (!res.ok) throw new Error(`Termii ${res.status} : ${await res.text()}`);
      return { ok: true, provider: 'termii' };
    }

    default:
      throw new Error(`Fournisseur SMS inconnu : ${config.smsProvider}`);
  }
}

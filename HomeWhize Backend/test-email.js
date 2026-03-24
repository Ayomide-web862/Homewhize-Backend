import { sendEmailSafely } from './config/emailConfig.js';

(async () => {
  try {
    console.log('🧪 Testing email delivery...');

    const result = await sendEmailSafely({
      from: 'HomeWhize <support@homewhize.com>',
      to: 'olawoyinjesutobiloba@gmail.com',
      subject: 'Test Email - Please Check Spam/Junk Folder',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">🧪 Email Delivery Test</h2>
          <p>This is a test email to verify delivery.</p>
          <p><strong>If you received this:</strong> Great! Email delivery is working.</p>
          <p><strong>If this went to spam:</strong> Check your spam/junk folder and mark as "not spam".</p>
          <p><strong>Sent at:</strong> ${new Date().toISOString()}</p>
          <hr>
          <p style="color: #666; font-size: 12px;">
            This test email was sent from HomeWhize SMTP server.
          </p>
        </div>
      `
    });

    if (result) {
      console.log('✅ Email sent successfully!');
      console.log('Response:', result.response);
      console.log('Message ID:', result.messageId);
    } else {
      console.log('❌ Email sending failed');
    }
  } catch (err) {
    console.error('❌ Test failed:', err.message);
  }
})();

import React from 'react';

const PUBLIC_URL = process.env.PUBLIC_URL;

const SupportMe = () =>{
  return (
    <div className='page-container'>
      <h1>Support Me</h1>
      {/* <div>Support Me</div> */}

      <div className='supportme'>
        <img className="meme" src={`${PUBLIC_URL}/img/donate-meme.webp`} alt="Donation meme" loading="lazy" decoding="async" />
        <form action="https://www.paypal.com/donate" method="post" target="_top">
          <input type="hidden" name="hosted_button_id" value="C69RN4UWJJF7A" />
          <input type="image" src="https://pics.paypal.com/00/s/YWQ1NmNmMDgtYTRkNi00NzA3LTk3M2MtOTRhYTBjZDk0MjNh/file.PNG" border="0" name="submit" title="PayPal - The safer, easier way to pay online!" alt="Donate with PayPal button" />
          <img alt="" border="0" src="https://www.paypal.com/en_MX/i/scr/pixel.gif" width="1" height="1" />
        </form>
        <img className="paypal" src={`${PUBLIC_URL}/img/paypal.webp`} alt="PayPal" loading="lazy" decoding="async" />
      </div>
    </div>
  );
}
export default SupportMe;
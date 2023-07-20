
import React, { useEffect } from 'react';

const Resume = ({setShowNavBar}) =>{

  useEffect(() => {
    setShowNavBar(true);
  },[])

  return (
    <div className='Resume'>
      <h1>Resume</h1>
      <iframe 
        className="container-iframe" 
        src="https://docs.google.com/document/d/e/2PACX-1vSx7hZ5Oekilnf_UPui5NcORAEQ1WIV8LPVBRk7bffB7d29uvK07zEviwmHG4vKYy-dUDMqqSgNvWfG/pub?embedded=true">
        </iframe>
    </div>
  );
}
export default Resume;
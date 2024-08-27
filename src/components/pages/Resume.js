import React, { useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import "../../styles/Resume.css"
const resumePdfUrl = '/resume.pdf';

const style =
{
    backgroundColor: "none",
    margin: "auto",
    textAlign: "center",
    width:  "fit-content",
    height:  "fit-content", /* Adjust based on your needs */
}

const Resume = ({ setShowNavBar }) => {
  useEffect(() => {
    setShowNavBar(true);
    // Set the workerSrc property
    pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.js`;
  }, []);

  const onDocumentLoadError = (error) => {
    console.error('Error loading PDF:', error);
  };

  return (
    <div className='Resume'>
      <h1>Resume</h1>
      <div classname="container-pdf">
        <Document file={resumePdfUrl} onLoadError={onDocumentLoadError}>
          <Page pageNumber={1} />
        </Document>
      </div>
    </div>
  );
};

export default Resume;
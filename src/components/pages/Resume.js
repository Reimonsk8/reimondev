import React, { useEffect } from 'react';
import "../../styles/Resume.css";

const resumePdfUrl = "https://my-video-storage-demo.s3.amazonaws.com/Resume+Jose+Ramon+Gomez+Armenta+2024.pdf";

const Resume = ({ setShowNavBar }) => {
    useEffect(() => {
        setShowNavBar(true);
    }, []);

    return (
        <div className="Resume">
          <h1>Resume</h1>
          <div className="container-pdf">
            <iframe
                src={resumePdfUrl}
                title="Resume PDF"
            />
          </div>
        </div>
    );
};

export default Resume;

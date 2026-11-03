import React, { useEffect, useState } from 'react';
import "../../styles/Resume.css";

const Resume = () => {
    const [resumeUrl, setResumeUrl] = useState("");

    useEffect(() => {
        // Default resume URL (ensure this is a valid URL to the file on S3)
        setResumeUrl("https://s3.us-east-1.amazonaws.com/reimondev.com/Resume+Jose+Ramon+Gomez+Armenta+2024+-+FullStack+DevOps.pdf");
    }, []);

    const switchResume = (version) => {
        switch (version) {
            case 1:
                setResumeUrl("https://s3.us-east-1.amazonaws.com/reimondev.com/Resume+Jose+Ramon+Gomez+Armenta+2024+-+FullStack+DevOps.pdf");
                break;
            case 2:
                setResumeUrl("https://s3.us-east-1.amazonaws.com/reimondev.com/Resume+Jose+Ramon+Gomez+Armenta+2024+-AI_ML+Data+Engineer.pdf");
                break;
            case 3:
                setResumeUrl("https://s3.us-east-1.amazonaws.com/reimondev.com/Resume+Jose+Ramon+Gomez+Armenta+2024+-+C%2B%2B+Game+Developer+Unreal+Engine.pdf");
                break;
            default:
                setResumeUrl("https://s3.us-east-1.amazonaws.com/reimondev.com/Resume+Jose+Ramon+Gomez+Armenta+2024+-+FullStack+DevOps.pdf");
                break;
        }
    };

    return (
        <div className="Resume">
          <h1>Resume</h1>
          <div>
            <div className='download-button' onClick={() => switchResume(1)}>FullStack DevOps</div>
            <div className='download-button' onClick={() => switchResume(2)}>AI_ML Data Engineer</div>
            <div className='download-button' onClick={() => switchResume(3)}>C++ Game Developer Unreal Engine</div> 
          </div>
          <div className="container-pdf">
            <iframe
                src={resumeUrl}
                title="Resume PDF"
                width="100%" 
                height="600px"
            />
          </div>
        </div>
    );
};

export default Resume;

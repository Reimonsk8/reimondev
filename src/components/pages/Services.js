import React from 'react';
import { Link } from 'react-router-dom';
import '../../styles/Services.css';

const SOFTWARE_SERVICES = [
  {
    id: 'web-apps',
    number: '01',
    category: 'WEB · SOFTWARE',
    title: 'Web apps & integrations',
    description: 'Build or improve a focused website, web application, or API-connected workflow.',
    details: [
      'Responsive pages and small-to-medium web application features.',
      'API and third-party service integrations.',
      'A clear handoff with source code and setup notes.',
    ],
  },
  {
    id: 'ai-workflows',
    number: '02',
    category: 'AI · AUTOMATION',
    title: 'AI workflows & automation',
    description: 'Connect existing AI tools and models to practical application or business workflows.',
    details: [
      'Prototype an AI-assisted feature using an agreed provider or local model.',
      'Automate a repeatable task and make its inputs and outputs clear.',
      'Scope includes integration and evaluation—not training a foundation model from scratch.',
    ],
  },
  {
    id: 'game-prototypes',
    number: '03',
    category: 'C++ · UNREAL ENGINE',
    title: 'Game & interactive prototypes',
    description: 'Explore a gameplay idea or technical interaction through a small, testable prototype.',
    details: [
      'C++ gameplay and systems prototypes, including Unreal Engine work.',
      'Focused mechanics, interaction, or multiplayer experiments.',
      'A defined proof of concept rather than a promise to deliver a full-scale game.',
    ],
  },
  {
    id: 'cloud-deployment',
    number: '04',
    category: 'CLOUD · DELIVERY',
    title: 'Cloud setup & deployment',
    description: 'Get an application deployed with a setup that fits its actual needs and budget.',
    details: [
      'Deployment configuration for AWS or a suitable managed hosting platform.',
      'Build and release automation for a clearly scoped project.',
      'Project delivery and documentation—not indefinite or 24/7 operations support.',
    ],
  },
  {
    id: 'data-ml',
    number: '05',
    category: 'DATA · MACHINE LEARNING',
    title: 'Data & ML prototypes',
    description: 'Turn a data or machine-learning idea into a small, measurable proof of concept.',
    details: [
      'Data preparation and focused pipeline work.',
      'Model or AI service integration for a defined use case.',
      'Prototype results and limitations documented before any production expansion.',
    ],
  },
];

const VISUAL_ART_SERVICES = [
  {
    id: 'event-mapping',
    number: '06',
    category: 'EVENTS · LIVE VISUALS',
    title: 'Custom 3D mapping visuals',
    description: 'Design original 3D visuals and mapping content for stages, DJ booths, venue façades, and other event surfaces, with onsite projection setup.',
    details: [
      'Create custom 3D scenes and loopable visuals shaped around the event and mapped surface.',
      'Plan content around venue dimensions, audience view, and playback setup.',
      'Set up, align, and calibrate projectors onsite for the agreed surfaces.',
    ],
    featured: true,
  },
  {
    id: 'music-production',
    number: '07',
    category: 'MUSIC · ABLETON LIVE',
    title: 'Music writing & production',
    description: 'Create and produce original music in Ableton across folk, electronic, and indie styles.',
    details: [
      'Develop a track from an initial idea, reference, or creative brief.',
      'Shape the arrangement and production to fit the intended style.',
      'Agree on instrumentation and final deliverables before starting.',
    ],
  },
];

function ServiceCard({ service }) {
  return (
    <article className={`service-card${service.featured ? ' service-card--featured' : ''}`}>
      <div className="service-card-heading">
        <span className="service-number" aria-hidden="true">{service.number}</span>
        <p className="service-category">{service.category}</p>
      </div>
      <h3>{service.title}</h3>
      <p className="service-description">{service.description}</p>
      <ul>
        {service.details.map((detail) => <li key={detail}>{detail}</li>)}
      </ul>
    </article>
  );
}

export default function Services() {
  return (
    <main className="services-page" aria-labelledby="services-title">
      <header className="services-intro">
        <p className="services-eyebrow">WHAT I CAN HELP BUILD</p>
        <h1 id="services-title">Practical work.<br /><span>Clearly scoped.</span></h1>
        <p className="services-lede">
          From event visuals and music to software and prototypes, I take on focused projects with concrete deliverables and a clear handoff.
        </p>
      </header>

      <section className="services-library" aria-label="Available services">
        <section className="service-group" aria-labelledby="software-engineering-title">
          <header className="service-group-heading">
            <p className="services-eyebrow">01 · BUILDING SYSTEMS</p>
            <h2 id="software-engineering-title">Software Engineering</h2>
            <p>Focused software, AI, game, cloud, and data projects with defined deliverables.</p>
          </header>
          <div className="services-grid services-grid--software">
            {SOFTWARE_SERVICES.map((service) => <ServiceCard service={service} key={service.id} />)}
          </div>
        </section>

        <section className="service-group service-group--visual" aria-labelledby="visual-art-title">
          <header className="service-group-heading">
            <p className="services-eyebrow">02 · MAKING EXPERIENCES</p>
            <h2 id="visual-art-title">Visual Art</h2>
            <p>Original visuals and music made for live events and creative projects.</p>
          </header>
          <div className="services-grid services-grid--visual">
            {VISUAL_ART_SERVICES.map((service) => <ServiceCard service={service} key={service.id} />)}
          </div>
        </section>

        <aside className="services-contact">
          <div>
            <p className="services-eyebrow">HAVE A PROJECT IN MIND?</p>
            <h2>Let’s define the right-sized version.</h2>
            <p>Share your goal, timeline, platform or venue, and the parts you need help with. I’ll let you know if it fits my scope.</p>
          </div>
          <a className="services-contact-link" href="mailto:reimonsk8@gmail.com">
            Discuss a project <span aria-hidden="true">↗</span>
          </a>
        </aside>
      </section>

      <footer className="services-footer">
        <Link to="/projects">Explore selected work <span aria-hidden="true">↗</span></Link>
      </footer>
    </main>
  );
}

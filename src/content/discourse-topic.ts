import { identifyDiscourseTopic, type DiscourseTopic } from "../shared/discourse-topic";

export function readDiscourseTopic(): DiscourseTopic | undefined {
  const setup = document.querySelector<HTMLMetaElement>("head meta#data-discourse-setup[data-base-url][data-base-uri]");
  return setup ? identifyDiscourseTopic(location.href, setup.dataset.baseUrl ?? "", setup.dataset.baseUri ?? "") : undefined;
}

import React, { ChangeEvent, Component, createRef, Fragment } from "react";
import Links from "./links";
import Nodes from "./nodes";
import style from "./map.css";
import { GraphI, LinkI, NodeI, Source, Target, ZigbeeRelationship } from "./types";
import { connect } from "unistore/react";
import { GlobalState } from "../../store";
import actions, { MapApi } from "../../actions";

import Button from "../button";
import { ForceLink, forceLink, forceCollide, forceCenter, forceSimulation, forceX, forceY } from "d3-force";
import { select, selectAll, Selection } from "d3-selection";
import { forceManyBodyReuse } from "d3-force-reuse"
import { zoom, zoomIdentity, ZoomTransform } from "d3-zoom";
import { linkTypes } from "./consts";
import Spinner from "../spinner";
import intersection from "lodash/intersection";
export interface MouseEventsResponderNode {
    onMouseOver?: (arg0: NodeI, el: SVGPolygonElement | SVGCircleElement | SVGImageElement) => void;
    onMouseOut?: (arg0: NodeI, el: SVGPolygonElement | SVGCircleElement | SVGImageElement) => void;
    onDblClick?: (arg0: NodeI, el: SVGPolygonElement | SVGCircleElement | SVGImageElement) => void;
}

interface MapState {
    selectedNode: NodeI;
    width: number;
    height: number;
    visibleLinks: ZigbeeRelationship[];
}
const angle = (s: Source, t: Target) => Math.atan2(t.y - s.y, t.x - s.x);
const xpos = (offset: number, s: Source, t: Target) => offset * Math.cos(angle(s, t)) + s.x;
const ypos = (offset: number, s: Source, t: Target) => offset * Math.sin(angle(s, t)) + s.y;



const parentOrChild = [ZigbeeRelationship.NeigbhorIsAChild, ZigbeeRelationship.NeigbhorIsParent];
const linkStrregth = (d: LinkI) => {
    if (d.linkType === "Router2Router") {
        return 1;
    }
    if (parentOrChild.includes(d.relationship)) {
        return 0.5;
    }

    return 0;
}

const distancesMap = {
    BrokenLink: 450,
    Router2Router: 200,
    Coordinator2Router: 200,
    Coordinator2EndDevice: 50,
    EndDevice2Router: 50
};


const getDistance = (d: LinkI): number => {
    return distancesMap[d.linkType] ?? 200;
    // const depth = ~~(Math.min(4, d.depth));
    // return 50 * depth + distance;
};

const computeLink = (d: LinkI, transform: ZoomTransform): string => {
    const src = d.source;
    const dst = d.target;
    const [x1, y1] = transform.apply([src.x, src.y]);
    const [x2, y2] = transform.apply([dst.x, dst.y]);
    return `M ${x1} ${y1} L ${x2} ${y2}`;
}

type SelNode = Selection<SVGElement, NodeI, HTMLElement, unknown>;
type SelLink = Selection<SVGElement, LinkI, HTMLElement, unknown>;

type TickedParams = {
    transform: ZoomTransform;
    node: SelNode;
    link: SelLink;
    linkLabel: SelLink;
    links: LinkI[];
}
const ticked = ({ transform, node, link, linkLabel, links }: TickedParams): void => {
    links.forEach(function (d) {
        const [x1, y1] = transform.apply([d.source.x, d.source.y]),
            [x2, y2] = transform.apply([d.target.x, d.target.y]),
            slope = (y2 - y1) / (x2 - x1);

        (d as unknown as NodeI).x = (x2 + x1) / 2;
        (d as unknown as NodeI).y = (x2 - x1) * slope / 2 + y1;
    });
    link.attr("d", (d) => computeLink(d, transform));
    linkLabel
        .attr('x', (d) => transform.applyX(xpos(100, d.source, d.target)))
        .attr('y', (d) => transform.applyY(ypos(100, d.source, d.target)))

    const imgXShift = 32 / 2;
    const imgYShift = 32 / 2;
    const computeTransform = (d: NodeI) => {
        const [X, Y] = transform.apply([d.x, d.y]);
        return `translate(${X - imgXShift}, ${Y - imgYShift})`;
    }
    node.attr("transform", computeTransform);
};
type ProcessHighlightsParams = {
    networkGraph: GraphI;
    links: LinkI[];
    selectedNode: NodeI;
    node: SelNode;
    link: SelLink;
    linkLabel: SelLink;
}
const processHighlights = ({ networkGraph, links, selectedNode, node, link, linkLabel }: ProcessHighlightsParams) => {
    const linkedByIndex = new Set<string>();
    networkGraph.nodes.forEach(n => linkedByIndex.add(n.ieeeAddr + "," + n.ieeeAddr));
    links.forEach((l) => linkedByIndex.add(l.sourceIeeeAddr + "," + l.targetIeeeAddr));

    const neighboring = (a: Source, b: Target): boolean => linkedByIndex.has(a.ieeeAddr + "," + b.ieeeAddr)
    const computeOpacity = (l: LinkI) => (l.source === selectedNode || l.target === selectedNode ? 1 : 0.15);
    if (selectedNode) {
        node.style("opacity", (o: NodeI) => neighboring(selectedNode, o) || neighboring(o, selectedNode) ? 1 : 0.15);
        link.style("stroke-opacity", computeOpacity);
        linkLabel.style("opacity", computeOpacity);
    } else {
        node.style("opacity", 1);
        link.style("stroke-opacity", 1);
        linkLabel.style("opacity", 1);
    }
}

export class MapComponent extends Component<GlobalState & MapApi, MapState> {
    ref = createRef<HTMLDivElement>();
    svgRef = createRef<SVGSVGElement>();
    simulation = forceSimulation<NodeI, LinkI>();
    state: Readonly<MapState> = {
        selectedNode: null,
        width: 0,
        height: 0,
        visibleLinks: parentOrChild
    };
    transform: ZoomTransform = zoomIdentity;

    updateNodes = (): void => {
        const { networkGraph } = this.props;
        if (!networkGraph.nodes.length) {
            return;
        }
        const { visibleLinks, selectedNode, width, height } = this.state;

        const node = selectAll<SVGElement, NodeI>(`.${style.node}`);
        const link = selectAll<SVGElement, LinkI>(`.${style.link}`);
        const linkLabel = selectAll<SVGElement, LinkI>(`.${style.linkLabel}`);

        const links = networkGraph.links.filter(l => intersection(visibleLinks, l.relationships).length);
        this.simulation.nodes(networkGraph.nodes.concat(links as unknown as NodeI[]));
        this.simulation.force<ForceLink<NodeI, LinkI>>("link").links(links);
        this.simulation.on("tick", () => ticked({ transform: this.transform, node, link, linkLabel, links }));


        //add zoom capabilities
        const everything = select<SVGGeometryElement, NodeI>('.everything');
        const zoomHandler = zoom()
            .extent([[0, 0], [width, height]])
            .scaleExtent([1 / 10, 8])
            .on("zoom", ({ transform }) => {
                everything.attr("transform", transform);
            });
        zoomHandler(select(this.svgRef.current));

        processHighlights({ networkGraph, links, selectedNode, node, link, linkLabel });
        node.on("click", (event, d: NodeI) => {
            const { selectedNode } = this.state;
            this.setState({ selectedNode: selectedNode ? null : d });
        });
        this.simulation.alphaTarget(0.03).restart();
    }


    updateForces(width: number, height: number): void {
        this.simulation = this.simulation
            .force("link", forceLink<NodeI, LinkI>().id(d => d.ieeeAddr).distance(getDistance).strength(linkStrregth))
            .force("charge", forceManyBodyReuse().strength(-700))
            .force("collisionForce", forceCollide())
            .force("center", forceCenter(width / 2, height / 2))
            .force("x", forceX().strength(0.1))
            .force("y", forceY().strength(0.2))
    }

    initPage(): void {
        const { width, height } = (this.ref.current as HTMLDivElement).getBoundingClientRect();
        this.setState({ width, height });
        this.updateForces(width, height);
    }

    componentDidMount(): void {
        this.initPage()
    }

    componentDidUpdate(): void {
        this.updateNodes();
    }

    renderMap() {
        const { width, height, visibleLinks } = this.state;

        const { networkGraph } = this.props;
        const links = networkGraph.links.filter(l => intersection(visibleLinks, l.relationships).length > 0);
        return (
            <svg ref={this.svgRef} viewBox={`0 0 ${width} ${height}`}>
                <g className="everything">
                    <Links links={links} />
                    <Nodes
                        nodes={networkGraph.nodes}
                        simulation={this.simulation}
                    />
                </g>
            </svg >
        )
    }
    onRequestClick = (): void => {
        const { networkMapRequest } = this.props;
        networkMapRequest();
    }
    renderMessage() {
        const { networkGraphIsLoading } = this.props;
        return (
            <div className="h-100 d-flex justify-content-center align-items-center">
                {
                    networkGraphIsLoading ? (
                        <div>
                            <Spinner />
                            <div>Depending on the size of your network this can take somewhere between 10 seconds and 2 minutes.</div>
                        </div>

                    ) : <Button onClick={this.onRequestClick} className="btn btn-primary d-block">Load map</Button>
                }
            </div>
        );
    }
    onLinkTypeFilterChange = (e: ChangeEvent<HTMLInputElement>): void => {
        const { visibleLinks: stateVisibleLinks } = this.state;
        const { checked, value } = e.target;
        const inValue = parseInt(value, 10);
        let visibleLinks = [...stateVisibleLinks];
        if (checked) {
            visibleLinks.push(inValue);
        } else {
            visibleLinks = visibleLinks.filter((v) => v !== inValue);
        }
        this.setState({ visibleLinks });
    }
    renderMapControls() {
        const { visibleLinks } = this.state;
        return <div className={style.controls}>
            {
                linkTypes.map(linkType => (
                    <div key={linkType.title} className="form-check form-check-inline">
                        <input onChange={this.onLinkTypeFilterChange} className="form-check-input" type="checkbox" id={linkType.title} value={linkType.relationship} checked={visibleLinks.includes(linkType.relationship)} />
                        <label className="form-check-label" htmlFor={linkType.title}>{linkType.title}</label>
                    </div>
                ))
            }
            {
                <div className="btn-group btn-group-sm" role="group">
                    <Button<void> title="Refresh data" className="btn btn-primary" onClick={this.onRequestClick}><i
                        className="fa fa-sync" /></Button>
                </div>
            }
        </div>
    }
    render() {
        const { networkGraph } = this.props;
        return (
            <div className={style.container} ref={this.ref}>
                {networkGraph.nodes.length ? <Fragment>{this.renderMapControls()} {this.renderMap()}</Fragment> : this.renderMessage()}
            </div>
        );
    }
}


const mappedProps = ["networkGraph", "networkGraphIsLoading"];
const ConnectedMap = connect<{}, MapState, GlobalState, {}>(mappedProps, actions)(MapComponent);
export default ConnectedMap;
